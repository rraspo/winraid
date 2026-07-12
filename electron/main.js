import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session,
  Tray,
  Menu,
  MenuItem,
  nativeImage,
  clipboard,
  dialog,
  shell,
  Notification,
  powerMonitor,
  net,
} from 'electron'
import { spawn } from 'child_process'
import { join, basename, relative, dirname, resolve, sep, extname } from 'path'
import { pathToFileURL } from 'url'
import { readFileSync, existsSync, mkdirSync, rmSync, statSync, utimesSync } from 'fs'
import { readdir as readdirAsync, stat as statAsync, mkdir as mkdirAsync, writeFile as writeFileAsync, readFile as readFileAsync, access as accessAsync, rm as rmAsync, unlink as unlinkAsync } from 'fs/promises'
import { createHash } from 'crypto'
import { homedir, userInfo, tmpdir } from 'os'
import { initLogger, getLogPath, clearLog, log } from './logger.js'
import { initActivity, pushActivity, tailActivity } from './activity.js'
import { describeActivity, failureTitle } from './activity-format.js'
import { listCommand, parseListOutput } from './remote-list.js'
import { validateRemotePath } from './validation.js'
import { sftpRmRf, backupWalkRemote, remoteWalkCreate, mediaWalk } from './sftp-helpers.js'
import { execWithTimeout } from './exec-helpers.js'
import { pickSizeTool, sizeCommand, parseSizeKb, probeCommand, parseProbe } from './size-tools.js'
import { shQuote } from './shell-quote.js'
import { ffmpegTrimCommand, ffmpegTrimArgs, probeFfmpegCommand, parseFfmpegProbe } from './video-trim.js'
import { findLocalFfmpeg, downloadFfmpeg, validateFfmpegBinary } from './ffmpeg-local.js'
import { createWindowOpenHandler, createWillNavigateHandler } from './window-guards.js'

// ---------------------------------------------------------------------------
// Process and app identity — must run synchronously before app.whenReady().
// Without these, Chromium child processes (GPU, utility, renderer) inherit
// the package.json "description" field as their Task Manager name in the
// packaged build.
//
// setAppUserModelId is skipped in dev: Windows looks up the AUMID in its
// registered apps, and without a Start Menu shortcut (which the NSIS
// installer creates in production) the lookup falls back to Electron's
// default icon — overriding BrowserWindow.icon. In dev we want Electron's
// own binary identity for Task Manager (unavoidable anyway) but the
// WinRaid icon on the taskbar entry, which the BrowserWindow.icon option
// provides as long as AUMID isn't redirecting it elsewhere.
// ---------------------------------------------------------------------------
app.setName('WinRaid')
if (app.isPackaged) {
  app.setAppUserModelId('com.winraid.app')
}

// ---------------------------------------------------------------------------
// Custom protocol scheme declaration — must happen synchronously before
// app.whenReady(), before any BrowserWindow is created.
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme:     'nas-stream',
    privileges: {
      standard:       true,
      supportFetchAPI: true,
      stream:         true,
      bypassCSP:      false,
    },
  },
])

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------
let mainWindow  = null
let tray        = null
let isPaused    = false
let _backupCurrentToken = null  // per-run cancellation token for backup:run
let _backupCurrentConn  = null  // active SSH Client during backup:run — used to interrupt fastGet

// Set of connectionIds that were watching before a pause-all operation,
// used by resume-all to restart only those connections.
let _watchingBeforePause = new Set()

let _watcher = null
let _queue   = null

/** Active size scans: connectionId → { cancelled: boolean } */
const _sizeScans = new Map()

/** Active media scans: connectionId → AbortController */
const _mediaScans = new Map()

// Names skipped during size scans (NAS metadata that inflates/clutters sizes).
const _SIZE_IGNORE = new Set(['@eaDir', '#recycle', '.@__thumb'])

// Detected sizing tool per connection (diskus if present, else du). Cached so
// detection runs once per connection rather than per scan.
const _sizeToolCache = new Map()

async function _detectSizeTool(connId, client) {
  if (_sizeToolCache.has(connId)) return _sizeToolCache.get(connId)
  let tool = 'du'
  try {
    const { stdout } = await execWithTimeout(client, probeCommand(), 15_000)
    tool = pickSizeTool(parseProbe(stdout))
  } catch {
    // probe failed — du is the safe default
  }
  _sizeToolCache.set(connId, tool)
  log('info', `[size-scan] sizing tool for ${connId}: ${tool}`)
  return tool
}

const _ffmpegCache = new Map()

// Detect whether ffmpeg is on PATH for this connection. Cached per connection,
// mirroring _detectSizeTool. Returns { available, version? }.
async function _detectFfmpeg(connId, client) {
  if (_ffmpegCache.has(connId)) return _ffmpegCache.get(connId)
  let probe = { available: false }
  try {
    const { stdout } = await execWithTimeout(client, probeFfmpegCommand(), 15_000)
    probe = parseFfmpegProbe(stdout)
  } catch {
    probe = { available: false }
  }
  _ffmpegCache.set(connId, probe)
  return probe
}

// List immediate children of dirPath with type + (file) size, via SFTP readdir.
function _readChildren(sftp, dirPath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, list) => {
      if (err) return reject(err)
      const base = dirPath.replace(/\/+$/, '')
      const out = []
      for (const e of list ?? []) {
        const name = e.filename
        if (!name || name.startsWith('.') || _SIZE_IGNORE.has(name)) continue
        const mode = e.attrs?.mode ?? 0
        const isDir = (mode & 0o170000) === 0o040000
        out.push({
          name,
          path: `${base}/${name}`,
          type: isDir ? 'dir' : 'file',
          sizeBytes: e.attrs?.size ?? 0,
        })
      }
      resolve(out)
    })
  })
}

// Recursive size (KB) of a single path using the detected tool. If a fast
// tool's output does not parse, fall back to du so results stay correct.
async function _sizeOne(client, tool, path) {
  try {
    const { stdout } = await execWithTimeout(client, sizeCommand(tool, path), 300_000)
    let kb = parseSizeKb(tool, stdout)
    if (kb == null && tool !== 'du') {
      const du = await execWithTimeout(client, sizeCommand('du', path), 300_000)
      kb = parseSizeKb('du', du.stdout)
    }
    return kb ?? 0
  } catch (err) {
    log('warn', `[size-scan] size failed: ${path} — ${err?.message ?? err}`)
    return 0
  }
}

/**
 * Scan ONE directory level and stream results: list children immediately
 * (files sized from the listing, directories pending at 0), then size each
 * subdirectory concurrently with the detected tool, emitting each as it
 * resolves. The renderer upserts by path so sizes fill in live. Returns the
 * child count for this level.
 */
async function _scanSizeLevel({ client, sftp, connectionId, dirPath, tool, concurrency, isCancelled, isActive, onProgress }) {
  const children = await _readChildren(sftp, dirPath)
  if (isCancelled?.()) return 0

  if (isActive?.() !== false) {
    sendToRenderer('size:level', {
      connectionId,
      parentPath: dirPath,
      entries: children.map((c) => ({
        name: c.name,
        path: c.path,
        sizeKb: c.type === 'dir' ? 0 : Math.round((c.sizeBytes || 0) / 1024),
      })),
    })
  }
  onProgress?.(dirPath, children.length)

  const dirs = children.filter((c) => c.type === 'dir')
  let idx = 0
  await new Promise((resolve) => {
    let active = 0
    function pump() {
      if (isCancelled?.()) { if (active === 0) resolve(); return }
      while (active < concurrency && idx < dirs.length) {
        const dir = dirs[idx++]
        active++
        ;(async () => {
          _poolTouch(connectionId)
          const sizeKb = await _sizeOne(client, tool, dir.path)
          if (isCancelled?.()) return
          if (isActive?.() !== false) {
            sendToRenderer('size:level', {
              connectionId,
              parentPath: dirPath,
              entries: [{ name: dir.name, path: dir.path, sizeKb }],
            })
          }
          onProgress?.(dir.path, children.length)
        })().finally(() => { active--; pump() })
      }
      if (active === 0 && idx >= dirs.length) resolve()
    }
    pump()
  })

  return children.length
}

async function getWatcher() {
  if (!_watcher) _watcher = await import('./watcher.js')
  return _watcher
}

async function getQueue() {
  if (!_queue) _queue = await import('./queue.js')
  return _queue
}

// ---------------------------------------------------------------------------
// IPC input validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates a cfg object received from the renderer before passing it to
 * any SSH/SFTP operation. Throws a TypeError with a descriptive message if
 * any required field is missing or malformed.
 *
 * @param {unknown} cfg
 * @throws {TypeError}
 */
function validateCfg(cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new TypeError('cfg must be a plain object')
  }
  if (typeof cfg.host !== 'string' || cfg.host.trim() === '') {
    throw new TypeError('cfg.host must be a non-empty string')
  }
  const port = Number(cfg.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('cfg.port must be an integer between 1 and 65535')
  }
  if (typeof cfg.username !== 'string' || cfg.username.trim() === '') {
    throw new TypeError('cfg.username must be a non-empty string')
  }
}

// ---------------------------------------------------------------------------
// SSH config parser — used by the ssh:scan-configs IPC handler
// ---------------------------------------------------------------------------
function parseSshConfig(content, homeDir) {
  const entries = []
  // currentGroup holds one entry per non-wildcard token on the Host line.
  // Subsequent option lines (Hostname, Port, User, IdentityFile) are applied
  // to every entry in the group so that multi-pattern Host lines like
  //   Host foo bar baz
  // produce three separate entries that all share the same options.
  let currentGroup = []

  for (let line of content.split('\n')) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue

    const spaceIdx = line.search(/\s/)
    if (spaceIdx === -1) continue
    const key = line.slice(0, spaceIdx).toLowerCase()
    const val = line.slice(spaceIdx).trim()

    if (key === 'host') {
      // Flush previous group
      for (const entry of currentGroup) entries.push(entry)
      currentGroup = []

      // Split on whitespace to support multi-value Host lines (e.g. "Host foo bar")
      const tokens = val.split(/\s+/).filter(Boolean)
      for (const token of tokens) {
        // Skip wildcard-only patterns (*, ?)
        if (!token.includes('*') && !token.includes('?')) {
          currentGroup.push({ hostPattern: token, host: token, port: 22, username: '', keyPath: '' })
        }
      }
    } else if (currentGroup.length > 0) {
      for (const current of currentGroup) {
        if (key === 'hostname')      current.host = val
        else if (key === 'port')     current.port = parseInt(val, 10) || 22
        else if (key === 'user')     current.username = val
        else if (key === 'identityfile') {
          // Expand leading ~ to the home directory
          current.keyPath = val.startsWith('~')
            ? join(homeDir, val.slice(1).replace(/^[/\\]/, ''))
            : val
        }
      }
    }
  }
  // Flush final group
  for (const entry of currentGroup) entries.push(entry)

  return entries
    .filter((e) => e.host && !e.host.includes('*'))
    .map((e) => ({
      host:     e.host,
      port:     e.port,
      username: e.username,
      keyPath:  e.keyPath,
      label:    [
        e.hostPattern !== e.host ? `${e.hostPattern} → ` : '',
        e.host,
        e.port !== 22 ? `:${e.port}` : '',
        e.username ? `  (${e.username})` : '',
      ].join(''),
    }))
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------

// The single URL every BrowserWindow in this app is allowed to load/navigate
// within — the dev server root in `electron-vite dev`, or the packaged
// index.html in the built .exe. Shared by the will-navigate guard on both
// the main window and the What's New window (both load the same renderer
// bundle, optionally with a `#whatsnew` hash).
function appEntryUrl() {
  return app.isPackaged
    ? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
    : 'http://localhost:5173/'
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 700,
    minWidth: 860,
    minHeight: 520,
    backgroundColor: '#0F1419',
    icon: join(__dirname, '../../assets/winraid_icon.ico'),
    // show: true so the window appears immediately — no dependency on
    // ready-to-show which can deadlock if the renderer errors before paint.
    show: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Enables Chromium's built-in PDF viewer so QuickLook can render PDFs in
      // an <iframe>. Safe alongside sandbox + contextIsolation (NPAPI is long
      // gone; this only turns on the bundled PDFium viewer).
      plugins: true,
    },
  })

  initLogger(sendToRenderer)
  initActivity(sendToRenderer)

  // Minimize to tray on close
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow.hide()
  })

  // Log renderer load failures so they surface in the terminal
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[main] Renderer failed to load: ${desc} (${code}) — ${url}`)
  })

  // If the renderer process crashes (e.g. GPU context lost after sleep), reload it.
  mainWindow.webContents.on('render-process-gone', (_e, { reason }) => {
    if (reason !== 'clean-exit') {
      console.warn(`[main] Renderer gone (${reason}) — reloading`)
      mainWindow.webContents.reload()
    }
  })

  // Navigation guards — renderer or NAS-sourced content (a crafted filename
  // rendered into a link, the CSP-whitelisted CDN content) must never be
  // able to spawn new windows or navigate this window away from the app's
  // own page. Legitimate external links are opened via shell.openExternal
  // from the renderer/IPC layer instead of window.open.
  mainWindow.webContents.setWindowOpenHandler(createWindowOpenHandler())
  mainWindow.webContents.on('will-navigate', createWillNavigateHandler(appEntryUrl()))

  // Native right-click context menu for nas-stream:// images.
  // Mirrors Chrome's image right-click behaviour (Copy image, Copy address).
  function popupImageContextMenu(connId, remotePath) {
    if (!connId || !validateRemotePath(remotePath)) return
    const menu = new Menu()
    menu.append(new MenuItem({
      label: 'Copy image',
      click: async () => {
        try {
          const sftp = await _poolGet(connId)
          if (!sftp) return
          _poolTouch(connId)
          const buf = await new Promise((resolve, reject) => {
            const chunks = []
            const stream = sftp.createReadStream(remotePath)
            stream.on('data', (c) => chunks.push(c))
            stream.on('end',  () => resolve(Buffer.concat(chunks)))
            stream.on('error', reject)
          })
          const img = nativeImage.createFromBuffer(buf)
          if (img.isEmpty()) {
            log('warn', `Copy image: nativeImage failed to decode ${remotePath}`)
            return
          }
          clipboard.writeImage(img)
          log('info', `Copied image to clipboard [${connId}]: ${remotePath}`)
        } catch (err) {
          log('error', `Copy image failed [${connId}] ${remotePath}: ${err.message}`)
        }
      },
    }))
    menu.append(new MenuItem({
      label: 'Copy image address',
      click: () => clipboard.writeText(remotePath),
    }))
    menu.popup({ window: mainWindow })
  }

  // Fires automatically for thumbnails — the img src is a real nas-stream:// URL.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    if (params.mediaType !== 'image') return
    const srcURL = params.srcURL || ''
    if (!srcURL.startsWith('nas-stream://')) return
    const url = new URL(srcURL)
    popupImageContextMenu(url.hostname, decodeURIComponent(url.pathname))
  })

  // Fallback for cases where the img.src is a blob: URL (e.g. QuickLook's
  // ImagePreview swaps to a blob URL after streaming the response). The
  // renderer calls this directly with the canonical connId + remotePath.
  ipcMain.handle('image:context-menu', (_e, connectionId, remotePath) => {
    popupImageContextMenu(connectionId, remotePath)
    return { ok: true }
  })

  // app.isPackaged is false during `electron-vite dev`, true in built .exe
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173/')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// What's New — a standalone window (not a modal) shown after an update.
// Loads the same renderer bundle with a #whatsnew hash so it renders only
// the WhatsNew view. Idempotency (show once per version) is handled by the
// caller; this just opens/closes the window.
// ---------------------------------------------------------------------------
let whatsNewWindow = null

function createWhatsNewWindow() {
  if (whatsNewWindow && !whatsNewWindow.isDestroyed()) {
    whatsNewWindow.focus()
    return
  }
  whatsNewWindow = new BrowserWindow({
    width: 560,
    height: 680,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#0F1419',
    title: 'What’s New',
    icon: join(__dirname, '../../assets/winraid_icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  whatsNewWindow.setMenuBarVisibility(false)
  whatsNewWindow.on('closed', () => { whatsNewWindow = null })

  // Same navigation guards as the main window — see createWindow().
  whatsNewWindow.webContents.setWindowOpenHandler(createWindowOpenHandler())
  whatsNewWindow.webContents.on('will-navigate', createWillNavigateHandler(appEntryUrl()))

  if (!app.isPackaged) {
    whatsNewWindow.loadURL('http://localhost:5173/#whatsnew')
  } else {
    whatsNewWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'whatsnew' })
  }
}

// ---------------------------------------------------------------------------
// System tray — optional; skipped gracefully if no icon asset is found
// ---------------------------------------------------------------------------
function createTray() {
  const assetsDir = join(__dirname, '../../assets')

  // Build a multi-resolution nativeImage from the tray-specific assets.
  // 16px @ 1x for standard DPI, 32px @ 2x for HiDPI / 200% scaling.
  let icon = nativeImage.createEmpty()
  for (const { file, scale } of [
    { file: 'winraid_icon_16x16.png', scale: 1.0 },
    { file: 'winraid_icon_32x32.png', scale: 2.0 },
  ]) {
    const img = nativeImage.createFromPath(join(assetsDir, file))
    if (!img.isEmpty()) icon.addRepresentation({ scaleFactor: scale, dataURL: img.toDataURL() })
  }

  // Fall back to the full ICO if the sized PNGs are missing
  if (icon.isEmpty()) {
    const img = nativeImage.createFromPath(join(assetsDir, 'winraid_icon.ico'))
    if (!img.isEmpty()) icon = img
  }

  if (icon.isEmpty()) {
    console.warn('[main] No tray icon found in assets/ — tray disabled.')
    return
  }

  tray = new Tray(icon)
  tray.setToolTip('WinRaid')
  rebuildTrayMenu()
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus() })
}

function rebuildTrayMenu() {
  if (!tray) return

  // Determine label: any watcher running or worker active => "Pause syncing"
  // otherwise "Resume syncing"
  const syncingLabel = isPaused ? 'Resume syncing' : 'Pause syncing'

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show WinRaid',
      click: () => { mainWindow.show(); mainWindow.focus() },
    },
    {
      label: syncingLabel,
      click: async () => {
        if (isPaused) {
          // Resume — delegate to the IPC handler logic
          isPaused = false
          const { getConfig } = await import('./config.js')
          const cfg = getConfig()
          const w   = await getWatcher()
          for (const connectionId of _watchingBeforePause) {
            const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
            if (!conn?.localFolder) continue
            try {
              if (!existsSync(conn.localFolder) || !statSync(conn.localFolder).isDirectory()) continue
            } catch { continue }
            w.startWatcher(
              connectionId,
              conn.localFolder,
              makeFileDetectedCallback(connectionId),
              () => sendToRenderer('watcher:status', w.listWatcherStates()),
            )
          }
          _watchingBeforePause.clear()
          const { ensureWorkerRunning } = await import('./worker.js')
          ensureWorkerRunning()
          sendToRenderer('watcher:status', w.listWatcherStates())
        } else {
          // Pause — stop all watchers and the worker
          isPaused = true
          const w = await getWatcher()
          _watchingBeforePause = new Set(
            Object.entries(w.listWatcherStates())
              .filter(([, s]) => s.watching)
              .map(([id]) => id)
          )
          w.stopAllWatchers()
          const { stopWorker } = await import('./worker.js')
          stopWorker()
          sendToRenderer('watcher:status', w.listWatcherStates())
        }
        rebuildTrayMenu()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { mainWindow.destroy(); app.quit() },
    },
  ])

  tray.setContextMenu(menu)
}

// ---------------------------------------------------------------------------
// Remote browser helpers
// ---------------------------------------------------------------------------

// Recursively walk a local directory and collect file paths (async to avoid
// blocking the main-process event loop on large directory trees).
async function walkLocal(dir, results = []) {
  for (const name of await readdirAsync(dir)) {
    const full = join(dir, name)
    if ((await statAsync(full)).isDirectory()) {
      await walkLocal(full, results)
    } else {
      results.push(full)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Backup helpers — NAS → local recursive download
// ---------------------------------------------------------------------------

// backupWalkRemote is imported from ./sftp-helpers.js.

// Recursively sum the size of all files under a local directory.
async function calcDirSize(dirPath) {
  let total = 0
  try {
    for (const entry of await readdirAsync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await calcDirSize(full)
      } else {
        try { total += (await statAsync(full)).size } catch { /* skip inaccessible */ }
      }
    }
  } catch { /* dir may not exist yet */ }
  return total
}

// Download a single file from the NAS to a local path, creating parent dirs.
async function backupDownloadFile(sftp, remotePath, localPath) {
  await mkdirAsync(dirname(localPath), { recursive: true })
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, { concurrency: 4, chunkSize: 256 * 1024 },
      (err) => err ? reject(err) : resolve()
    )
  })
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function registerIPC() {
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:select-download-path', async (_e, defaultName, isDir) => {
    if (isDir) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose download destination',
        properties: ['openDirectory', 'createDirectory'],
      })
      return result.canceled ? null : result.filePaths[0]
    } else {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: defaultName,
      })
      return result.canceled ? null : result.filePath
    }
  })

  ipcMain.handle('config:get', async (_e, key) => {
    const { getConfig } = await import('./config.js')
    return key != null ? getConfig(key) : getConfig()
  })

  ipcMain.handle('whatsnew:open', () => {
    createWhatsNewWindow()
    return { ok: true }
  })

  ipcMain.handle('whatsnew:close', () => {
    if (whatsNewWindow && !whatsNewWindow.isDestroyed()) whatsNewWindow.close()
    return { ok: true }
  })

  const CONFIG_SET_ALLOWLIST = [
    'localFolder', 'operation', 'folderMode', 'extensions', 'ignoredExtensions',
    'backup', 'connections', 'backupByConnection',
    'browse', 'playDefaults', 'snapshot', 'thumbSeek', 'activeConnectionId',
    'favoritesByConnection',
  ]

  ipcMain.handle('config:set', async (_e, key, value) => {
    const topKey = String(key).split('.')[0]
    if (!CONFIG_SET_ALLOWLIST.includes(topKey)) {
      return { error: 'forbidden key' }
    }
    const { setConfig } = await import('./config.js')
    return setConfig(key, value)
  })

  ipcMain.handle('watcher:start', async (_e, connectionId) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false, error: 'Invalid connectionId' }
    }
    const { getConfig } = await import('./config.js')
    const cfg  = getConfig()
    const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
    if (!conn) return { ok: false, error: 'connection not found' }
    const folder = conn.localFolder
    if (!folder || typeof folder !== 'string') return { ok: false, error: 'no local folder configured' }
    try {
      if (!existsSync(folder) || !statSync(folder).isDirectory()) {
        return { ok: false, error: 'local folder does not exist or is not a directory' }
      }
    } catch {
      return { ok: false, error: 'cannot access local folder' }
    }
    const w = await getWatcher()
    w.startWatcher(
      connectionId,
      folder,
      makeFileDetectedCallback(connectionId),
      () => sendToRenderer('watcher:status', w.listWatcherStates()),
    )
    sendToRenderer('watcher:status', w.listWatcherStates())
    rebuildTrayMenu()
    // Kick the worker for any PENDING jobs that were skipped by hasActiveJob
    const q = await getQueue()
    if (q.listJobs().some((j) => j.status === 'PENDING')) {
      const { ensureWorkerRunning } = await import('./worker.js')
      ensureWorkerRunning()
    }
    return { ok: true }
  })

  ipcMain.handle('watcher:stop', async (_e, connectionId) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false, error: 'Invalid connectionId' }
    }
    const w = await getWatcher()
    w.stopWatcher(connectionId)
    sendToRenderer('watcher:status', w.listWatcherStates())
    rebuildTrayMenu()
    return { ok: true }
  })

  ipcMain.handle('watcher:list', async () => {
    const w = await getWatcher()
    return w.listWatcherStates()
  })

  // Soft pause -- leaves the interval running but stops dequeuing.
  // Called alongside watcher:pause-all (which does a hard stop via stopWorker)
  // so that the queue resumes correctly when watcher:resume-all restarts the interval.
  ipcMain.handle('queue:pause', async () => {
    const { pauseWorker } = await import('./worker.js')
    pauseWorker()
  })

  ipcMain.handle('queue:resume', async () => {
    const { resumeWorker } = await import('./worker.js')
    resumeWorker()
  })

  ipcMain.handle('watcher:pause-all', async () => {
    isPaused = true
    const w = await getWatcher()
    // Capture which connections were watching so resume-all can restart them
    _watchingBeforePause = new Set(
      Object.entries(w.listWatcherStates())
        .filter(([, s]) => s.watching)
        .map(([id]) => id)
    )
    w.stopAllWatchers()
    const { stopWorker } = await import('./worker.js')
    stopWorker()
    sendToRenderer('watcher:status', w.listWatcherStates())
    rebuildTrayMenu()
    return { ok: true }
  })

  ipcMain.handle('watcher:resume-all', async () => {
    isPaused = false
    const { getConfig } = await import('./config.js')
    const cfg = getConfig()
    const w   = await getWatcher()
    for (const connectionId of _watchingBeforePause) {
      const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
      if (!conn?.localFolder) continue
      try {
        if (!existsSync(conn.localFolder) || !statSync(conn.localFolder).isDirectory()) continue
      } catch { continue }
      w.startWatcher(
        connectionId,
        conn.localFolder,
        makeFileDetectedCallback(connectionId),
        () => sendToRenderer('watcher:status', w.listWatcherStates()),
      )
    }
    _watchingBeforePause.clear()
    const { ensureWorkerRunning } = await import('./worker.js')
    ensureWorkerRunning()
    sendToRenderer('watcher:status', w.listWatcherStates())
    rebuildTrayMenu()
    return { ok: true }
  })

  ipcMain.handle('queue:list', async () => {
    const q = await getQueue()
    return q.listJobs()
  })

  ipcMain.handle('queue:stats', async () => {
    const q = await getQueue()
    return { lifetimeCompleted: q.getLifetimeCompleted() }
  })

  ipcMain.handle('queue:reduce-completed', async (_e, n) => {
    const q = await getQueue()
    const lifetimeCompleted = q.reduceLifetimeCompleted(Number(n) || 0)
    sendToRenderer('queue:updated', { type: 'stats' })
    return { lifetimeCompleted }
  })

  ipcMain.handle('queue:retry', async (_e, jobId) => {
    const q = await getQueue()
    q.retryJob(jobId)
    sendToRenderer('queue:updated', { type: 'retry', jobId })
  })

  ipcMain.handle('queue:remove', async (_e, jobId) => {
    const q = await getQueue()
    q.removeJob(jobId)
    sendToRenderer('queue:updated', { type: 'removed', jobId })
  })

  ipcMain.handle('queue:clear-done', async () => {
    const q = await getQueue()
    q.clearDone()
    sendToRenderer('queue:updated', { type: 'cleared' })
  })

  ipcMain.handle('queue:clear-stale', async () => {
    const q = await getQueue()
    const removedIds = q.clearStale()
    for (const jobId of removedIds) {
      sendToRenderer('queue:updated', { type: 'removed', jobId })
    }
    return { removed: removedIds.length }
  })

  ipcMain.handle('queue:cancel', async (_e, jobId) => {
    const q = await getQueue()
    const jobs = q.listJobs()
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return { ok: false, error: 'job not found' }

    if (job.status === q.STATUS.PENDING) {
      // Remove the job from the queue entirely.
      q.updateJob(jobId, { status: q.STATUS.ERROR, errorMsg: 'Cancelled' })
      q.removeJob(jobId)
      sendToRenderer('queue:updated', { type: 'removed', jobId })
    } else if (job.status === q.STATUS.TRANSFERRING) {
      // No active transfer abort mechanism — mark ERROR as best-effort cancel.
      q.updateJob(jobId, { status: q.STATUS.ERROR, errorMsg: 'Cancelled' })
      sendToRenderer('queue:updated', {
        type: 'updated',
        job: { ...job, status: q.STATUS.ERROR, errorMsg: 'Cancelled' },
      })
    }
    return { ok: true }
  })

  ipcMain.handle('queue:enqueue-batch', async (_e, connectionId, localFolder, relPaths) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false, error: 'Invalid connectionId' }
    }
    const { getConfig } = await import('./config.js')
    const cfg  = getConfig()
    const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
    if (!conn) return { ok: false, error: 'connection not found' }
    if (!Array.isArray(relPaths)) return { ok: false, error: 'invalid relPaths' }
    const resolvedBase = resolve(conn.localFolder)
    const q = await getQueue()
    for (const rel of relPaths) {
      if (typeof rel !== 'string' || rel.includes('..')) continue
      const filePath = join(localFolder, ...rel.split('/'))
      if (!resolve(filePath).startsWith(resolvedBase + sep)) continue
      if (isExtensionBlocked(filePath, conn)) continue
      const relPath  = conn.folderMode === 'flat' ? basename(filePath) : rel
      let fileSize = null
      try { fileSize = statSync(filePath).size } catch { /* file may have been removed */ }
      const jobId    = q.enqueue(filePath, { relPath, operation: conn.operation, connectionId, size: fileSize })
      sendToRenderer('queue:updated', { type: 'added', jobId })
    }
    try {
      const { ensureWorkerRunning } = await import('./worker.js')
      ensureWorkerRunning()
    } catch { /* worker may already be running */ }
    return { ok: true, count: relPaths.length }
  })

  ipcMain.handle('queue:drop-upload', async (_e, connectionId, remoteDest, localPaths) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false, error: 'Invalid connectionId' }
    }
    if (!validateRemotePath(remoteDest)) {
      return { ok: false, error: 'Invalid remoteDest' }
    }
    if (!Array.isArray(localPaths) || localPaths.length === 0) {
      return { ok: false, error: 'Invalid localPaths' }
    }

    const { getConfig } = await import('./config.js')
    const cfg  = getConfig()
    const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
    if (!conn) return { ok: false, error: 'Connection not found' }

    async function collectFiles(dirPath, relPrefix) {
      const results = []
      const dirEntries = await readdirAsync(dirPath, { withFileTypes: true })
      for (const entry of dirEntries) {
        const fullPath = join(dirPath, entry.name)
        const relPath  = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          results.push(...await collectFiles(fullPath, relPath))
        } else if (entry.isFile()) {
          results.push({ fullPath, relPath })
        }
      }
      return results
    }

    const q = await getQueue()
    let count = 0

    for (const localPath of localPaths) {
      if (typeof localPath !== 'string') continue
      let s
      try { s = await statAsync(localPath) } catch { continue }

      if (s.isFile()) {
        if (isExtensionBlocked(localPath, conn)) continue
        const jobId = q.enqueue(localPath, {
          relPath:      basename(localPath),
          remoteDest,
          operation:    conn.operation,
          connectionId,
          size:         s.size,
        })
        sendToRenderer('queue:updated', { type: 'added', jobId })
        count++
      } else if (s.isDirectory()) {
        const dirName = basename(localPath)
        const files   = await collectFiles(localPath, dirName)
        for (const { fullPath, relPath } of files) {
          if (isExtensionBlocked(fullPath, conn)) continue
          let fileSize = null
          try { fileSize = (await statAsync(fullPath)).size } catch { /* file removed */ }
          const jobId = q.enqueue(fullPath, {
            relPath,
            remoteDest,
            operation:    conn.operation,
            connectionId,
            size:         fileSize,
          })
          sendToRenderer('queue:updated', { type: 'added', jobId })
          count++
        }
      }
    }

    try {
      const { ensureWorkerRunning, isWorkerRunning } = await import('./worker.js')
      const wasRunning = isWorkerRunning()
      ensureWorkerRunning()
      log('info', `drop-upload: ${count} job(s) queued — worker was ${wasRunning ? 'already running' : 'started now'}`)
    } catch (err) {
      log('warn', `drop-upload: worker start failed: ${err.message}`)
    }

    return { ok: true, count }
  })

  // -- Activity feed ---------------------------------------------------------
  ipcMain.handle('activity:tail', (_e, n = 50) => tailActivity(Number(n) || 50))

  ipcMain.handle('activity:reveal', (_e, localPath) => {
    if (typeof localPath !== 'string' || !localPath.trim()) return { ok: false }
    shell.showItemInFolder(localPath)
    return { ok: true }
  })

  // -- Logs ------------------------------------------------------------------
  ipcMain.handle('log:get-path', () => getLogPath())

  ipcMain.handle('log:tail', (_e, n = 300) => {
    const p = getLogPath()
    if (!p) return []
    try {
      const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
      return lines.slice(-n).map((line, i) => {
        const m = line.match(/^\[(\d{2}:\d{2}:\d{2})] \[(\w+)\s*] (.+)$/)
        if (!m) return { level: 'info', message: line, ts: 0, key: `tail-${i}` }
        const [, time, level, message] = m
        const ts = new Date(`${new Date().toDateString()} ${time}`).getTime()
        return { level: level.toLowerCase(), message, ts, key: `tail-${i}-${ts}` }
      })
    } catch {
      return []
    }
  })

  // -- Local filesystem -------------------------------------------------------
  ipcMain.handle('local:clear-folder', (_e, folderPath) => {
    try {
      const homeDir     = app.getPath('home')
      const resolved    = resolve(folderPath)
      const homePrefix  = homeDir.endsWith(sep) ? homeDir : homeDir + sep
      if (resolved === homeDir || !resolved.startsWith(homePrefix)) {
        return { ok: false, error: 'Path is outside the user home directory.' }
      }
      rmSync(resolved, { recursive: true, force: true })
      mkdirSync(resolved, { recursive: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // Whether a local path currently exists — used to gate the browse view's
  // "Reveal in Explorer" action so it only shows when a mirrored copy is present.
  ipcMain.handle('local:exists', (_e, p) => {
    if (typeof p !== 'string' || !p.trim()) return false
    try { return existsSync(resolve(p)) } catch { return false }
  })

  // Reveal a local folder/file in the OS file manager (no-op if it's gone).
  ipcMain.handle('local:reveal', (_e, p) => {
    if (typeof p !== 'string' || !p.trim()) return { ok: false }
    const resolved = resolve(p)
    if (!existsSync(resolved)) return { ok: false, error: 'Local path no longer exists.' }
    shell.showItemInFolder(resolved)
    return { ok: true }
  })

  ipcMain.handle('log:reveal', () => {
    const p = getLogPath()
    if (p) shell.showItemInFolder(p)
  })

  ipcMain.handle('log:clear', () => {
    clearLog()
  })

  // -- Thumbnail cache --------------------------------------------------------
  ipcMain.handle('cache:thumb-size', async () => {
    const thumbsDir = join(app.getPath('userData'), 'thumbs')

    async function sumDir(dir) {
      let total = 0
      let entries
      try {
        entries = await readdirAsync(dir, { withFileTypes: true })
      } catch {
        return 0
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          total += await sumDir(full)
        } else {
          try {
            const st = await statAsync(full)
            total += st.size
          } catch {
            // inaccessible — skip
          }
        }
      }
      return total
    }

    const bytes = await sumDir(thumbsDir)
    return { bytes }
  })

  ipcMain.handle('cache:clear-thumbs', async () => {
    const thumbsDir = join(app.getPath('userData'), 'thumbs')
    try {
      await rmAsync(thumbsDir, { recursive: true, force: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- Fetch a remote URL (http/https) and return its bytes + content-type ----
  // Used by the paste-from-URL flow so the renderer can preview and save
  // arbitrary remote content (images, videos, generic files) without dealing
  // with CORS in the renderer.
  ipcMain.handle('url:fetch', async (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'Only http(s) URLs are supported' }
    }
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }

      const ab = await res.arrayBuffer()
      if (ab.byteLength > 100 * 1024 * 1024) return { ok: false, error: 'Payload too large (max 100 MB)' }

      const rawMime = res.headers.get('content-type') ?? 'application/octet-stream'
      const mime    = rawMime.split(';')[0].trim()

      let filename = ''
      const cd = res.headers.get('content-disposition')
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
        if (m) { try { filename = decodeURIComponent(m[1]) } catch { filename = m[1] } }
      }
      if (!filename) {
        try {
          const u = new URL(url)
          filename = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '')
        } catch { /* not a valid URL — leave filename empty */ }
      }

      return { ok: true, mime, filename, bytes: ab }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- Invalidate the on-disk full + thumb cache for a single remote path -----
  // Used after a remote-mutating operation (e.g. crop save) so the next
  // request streams fresh bytes from SFTP rather than serving the stale copy.
  ipcMain.handle('cache:invalidate-file', async (_e, connectionId, remotePath) => {
    if (typeof connectionId !== 'string' || !connectionId) return { ok: false, error: 'Invalid connection' }
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    await unlinkAsync(fullCachePath(connectionId, remotePath)).catch(() => {})
    await unlinkAsync(thumbCachePath(connectionId, remotePath)).catch(() => {})
    return { ok: true }
  })

  // -- SSH: test connection ---------------------------------------------------
  ipcMain.handle('ssh:test', async (_e, cfg) => {
    try {
      validateCfg(cfg)
      const { Client } = await import('ssh2')

      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try {
          privateKey = readFileSync(kp)
        } catch (e) {
          return { ok: false, error: `Cannot read key file: ${e.message}` }
        }
      }

      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => { conn.end(); resolve({ ok: true }) })
          .on('error', (err) => resolve({ ok: false, error: err.message }))
          .connect({
            host:         cfg.host,
            port:         cfg.port || 22,
            username:     cfg.username,
            password:     cfg.password?.trim() || undefined,
            privateKey:   privateKey || undefined,
            readyTimeout: 10_000,
          })
      })
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- SSH: scan ~/.ssh/config + WSL ------------------------------------------
  ipcMain.handle('ssh:scan-configs', async () => {
    const home = homedir()
    const candidates = [join(home, '.ssh', 'config')]

    // Add WSL distro paths if accessible
    try {
      const username = userInfo().username
      for (const distro of ['Ubuntu', 'Ubuntu-22.04', 'Ubuntu-24.04', 'Debian']) {
        candidates.push(`\\\\wsl.localhost\\${distro}\\home\\${username}\\.ssh\\config`)
      }
    } catch { /* userInfo() unavailable on some systems */ }

    const results = []
    const seen = new Set()

    for (const cfgPath of candidates) {
      if (!existsSync(cfgPath)) continue
      try {
        const content = readFileSync(cfgPath, 'utf8')
        for (const e of parseSshConfig(content, home)) {
          const key = `${e.host}:${e.port}:${e.username}`
          if (!seen.has(key)) {
            seen.add(key)
            results.push(e)
          }
        }
      } catch { /* malformed SSH config file — skip */ }
    }

    return results
  })

  // -- Remote browser: list directory ----------------------------------------
  ipcMain.handle('remote:list', async (_e, connectionId, remotePath) => {
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const poolEntry = _sftpPool.get(connectionId)
      const client = poolEntry?.client

      const sortEntries = (entries) => entries
        .filter((e) => !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        })

      // Try a single `find -printf` — one process for the whole directory,
      // regardless of size. Falls through to sftp.readdir if find/-printf is
      // unavailable (busybox / restricted shells → non-zero exit).
      // [perf] timing logs are temporary diagnostics for the large-folder probe.
      if (client) {
        const t0 = Date.now()
        try {
          const { code, stdout } = await execWithTimeout(client, listCommand(remotePath), 60_000)
          if (code === 0 && stdout.trim()) {
            const entries = sortEntries(parseListOutput(stdout))
            log('info', `[perf] list via find: ${entries.length} entries in ${Date.now() - t0}ms — ${remotePath}`)
            return { ok: true, entries }
          }
          log('warn', `[perf] list find unusable (exit ${code}) after ${Date.now() - t0}ms, falling back to readdir — ${remotePath}`)
        } catch (e) {
          log('warn', `[perf] list find errored after ${Date.now() - t0}ms (${e.message}), falling back to readdir — ${remotePath}`)
        }
      }

      // Fallback: sftp.readdir (compatible with restricted shells / busybox)
      const tReaddir = Date.now()
      return new Promise((resolve) => {
        sftp.readdir(remotePath, (err, list) => {
          if (err) return resolve({ ok: false, error: err.message })
          const entries = sortEntries(list.map((e) => ({
            name:     e.filename,
            type:     ((e.attrs.mode ?? 0) & 0o170000) === 0o040000 ? 'dir' : 'file',
            size:     e.attrs.size ?? 0,
            modified: (e.attrs.mtime ?? 0) * 1000,
          })))
          log('info', `[perf] list via readdir: ${entries.length} entries in ${Date.now() - tReaddir}ms — ${remotePath}`)
          resolve({ ok: true, entries })
        })
      })
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('remote:tree', async (_e, connectionId, rootPath) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false, error: 'Invalid connectionId' }
    if (!validateRemotePath(rootPath)) return { ok: false, error: 'Invalid remote path' }
    try {
      await _poolGet(connectionId)
      const poolEntry = _sftpPool.get(connectionId)
      if (!poolEntry) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const { client } = poolEntry

      const safePath = rootPath.replace(/'/g, "'\\''")
      const rootNorm = rootPath.replace(/\/+$/, '') || '/'
      const noiseFilter = `-not -path '*/@eaDir*' -not -name '#recycle' -not -name '.@__thumb'`
      const cmd = `find '${safePath}' -mindepth 1 ${noiseFilter} -not -name '.*'`
      const pipeline = cmd + ` | while IFS= read -r p; do t=$([ -d "$p" ] && echo d || echo f); s=$(stat -c '%s' "$p" 2>/dev/null || echo 0); m=$(stat -c '%Y' "$p" 2>/dev/null || echo 0); rel="\${p#${rootNorm}/}"; printf '%s\\t%s\\t%s\\t%s\\n' "$t" "$s" "$m" "$rel"; done`

      let stdout, code
      try {
        ;({ code, stdout } = await execWithTimeout(client, pipeline, 60_000))
      } catch (err) {
        return { ok: false, error: err.message }
      }

      // Treat non-zero exit as partial success (Synology @eaDir / permission denied)
      const dirMap = {}
      for (const line of stdout.split('\n')) {
        if (!line) continue
        const t1 = line.indexOf('\t')
        const t2 = line.indexOf('\t', t1 + 1)
        const t3 = line.indexOf('\t', t2 + 1)
        if (t3 === -1) continue
        const type    = line.slice(0, t1)
        const sizeStr = line.slice(t1 + 1, t2)
        const mtStr   = line.slice(t2 + 1, t3)
        const relPath = line.slice(t3 + 1)
        if (!relPath) continue
        const parts      = relPath.split('/')
        const name       = parts.at(-1)
        const parentRel  = parts.slice(0, -1).join('/')
        const parentPath = parentRel
          ? (rootNorm === '/' ? '/' + parentRel : rootNorm + '/' + parentRel)
          : rootNorm
        if (!dirMap[parentPath]) dirMap[parentPath] = []
        dirMap[parentPath].push({
          name,
          type:     type === 'd' ? 'dir' : 'file',
          size:     parseInt(sizeStr, 10) || 0,
          modified: parseInt(mtStr, 10) * 1000,
        })
      }
      for (const arr of Object.values(dirMap)) {
        arr.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
      if (code !== 0) log('warn', `remote:tree exited ${code} for ${rootPath} — returning partial results`)
      return { ok: true, partial: code !== 0, dirMap }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: check out folder structure locally --------------------
  ipcMain.handle('remote:checkout', async (_e, connectionId, remotePath, localRoot) => {
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const conn = await _getConnConfig(connectionId)
      const remoteBase = (conn?.sftp?.remotePath || '').replace(/\/+$/, '')
      const rel = remotePath.startsWith(remoteBase)
        ? remotePath.slice(remoteBase.length).replace(/^\/+/, '')
        : remotePath.replace(/^\/+/, '')
      const localTarget = rel
        ? join(localRoot, ...rel.split('/').filter(Boolean))
        : localRoot
      const created = []
      await remoteWalkCreate(sftp, remotePath, localTarget, created)
      log('info', `Remote checkout [${await _connLabel(connectionId)}]: ${remotePath} -> ${localTarget} (${created.length} files)`)
      emitActivity({ type: 'checkout', connectionId, payload: { count: created.length, localDir: localTarget } })
      return { ok: true, created }
    } catch (err) {
      log('error', `Remote checkout failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
      emitActivity({ type: 'checkout', connectionId, level: 'error', error: err.message })
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: download file or folder to local path ---------------
  ipcMain.handle('remote:download', async (_e, connectionId, remotePath, localPath, isDir) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false, error: 'Invalid connectionId' }
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      if (isDir) {
        const files = await backupWalkRemote(sftp, remotePath, basename(remotePath))
        const total = files.length
        sendToRenderer('download:progress', { connectionId, name: basename(remotePath), filesProcessed: 0, totalFiles: total, bytesTransferred: 0, totalBytes: 0 })
        for (let i = 0; i < files.length; i++) {
          const { remotePath: rp, relPath } = files[i]
          sendToRenderer('download:progress', { connectionId, name: basename(remotePath), filesProcessed: i, totalFiles: total, bytesTransferred: 0, totalBytes: 0 })
          await backupDownloadFile(sftp, rp, join(localPath, relPath))
        }
        log('info', `Download [${await _connLabel(connectionId)}]: ${remotePath} -> ${localPath} (${files.length} files)`)
        emitActivity({ type: 'download', connectionId, payload: { name: basename(remotePath), localDir: join(localPath, basename(remotePath)) } })
        return { ok: true, count: files.length }
      } else {
        const name = basename(remotePath)
        await mkdirAsync(dirname(localPath), { recursive: true })
        await new Promise((resolve, reject) => {
          sftp.fastGet(remotePath, localPath, {
            concurrency: 4,
            chunkSize: 256 * 1024,
            step: (bytesTransferred, _chunk, totalBytes) => {
              sendToRenderer('download:progress', { connectionId, name, filesProcessed: 0, totalFiles: 1, bytesTransferred, totalBytes })
            },
          }, (err) => err ? reject(err) : resolve())
        })
        log('info', `Download [${await _connLabel(connectionId)}]: ${remotePath} -> ${localPath}`)
        emitActivity({ type: 'download', connectionId, payload: { name, localDir: localPath } })
        return { ok: true, count: 1 }
      }
    } catch (err) {
      log('error', `Download failed [${await _connLabel(connectionId)}]: ${err.message}`)
      emitActivity({ type: 'download', connectionId, level: 'error', error: err.message })
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: read file content ------------------------------------
  ipcMain.handle('remote:read-file', async (_e, connectionId, remotePath) => {
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    const MAX_READ_BYTES = 50 * 1024 * 1024
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const stat = await new Promise((resolve, reject) =>
        sftp.stat(remotePath, (err, s) => err ? reject(err) : resolve(s))
      )
      if ((stat.size ?? 0) > MAX_READ_BYTES) {
        return { ok: false, error: `File too large for editor (${Math.round(stat.size / 1024 / 1024)} MB, max 50 MB)` }
      }
      return new Promise((resolve) => {
        sftp.readFile(remotePath, 'utf8', (err, content) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true, content })
        })
      })
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: delete file or directory tree ------------------------
  ipcMain.handle('remote:delete', async (_e, connectionId, remotePath, isDir) => {
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      if (isDir) {
        await sftpRmRf(sftp, remotePath)
      } else {
        await new Promise((res, rej) =>
          sftp.unlink(remotePath, (e) => e ? rej(e) : res())
        )
      }
      log('info', `Remote ${isDir ? 'directory' : 'file'} deleted [${await _connLabel(connectionId)}]: ${remotePath}`)
      emitActivity({
        type: 'delete', connectionId,
        payload: { name: remotePath.split('/').pop(), parentDir: remotePath.slice(0, remotePath.lastIndexOf('/')) || '/' },
      })
      return { ok: true }
    } catch (err) {
      log('error', `Remote delete failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
      emitActivity({ type: 'delete', connectionId, level: 'error', error: err.message })
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: move / rename ----------------------------------------
  ipcMain.handle('remote:move', async (_e, connectionId, srcPath, dstPath) => {
    if (!validateRemotePath(srcPath) || !validateRemotePath(dstPath)) return { ok: false, error: 'Invalid remote path' }
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const poolEntry = _sftpPool.get(connectionId)
      const client = poolEntry?.client

      // Prefer SSH exec mv — handles cross-device moves (mergerfs EXDEV) that
      // sftp.rename() cannot; fall back to sftp.rename() for restricted shells.
      const label = await _connLabel(connectionId)
      let result
      let usedFallback = false
      if (client) {
        result = await new Promise((resolve) => {
          client.exec(`mv -- ${shQuote(srcPath)} ${shQuote(dstPath)}`, (err, stream) => {
            if (err) {
              log('warn', `Remote move [${label}]: SSH exec error (${err.message}), falling back to SFTP rename`)
              return resolve(null)
            }
            stream.resume()  // drain stdout so the SSH window doesn't stall
            const stderrChunks = []
            stream.stderr.on('data', (chunk) => stderrChunks.push(chunk))
            stream.on('error', (streamErr) => {
              log('warn', `Remote move [${label}]: SSH stream error (${streamErr.message}), falling back to SFTP rename`)
              resolve(null)
            })
            stream.on('close', (code) => {
              if (code === 0) return resolve({ ok: true })
              const stderr = stderrChunks.join('').trim()
              log('warn', `Remote move [${label}]: mv exited ${code}${stderr ? ` — ${stderr}` : ''}, falling back to SFTP rename`)
              resolve(null)
            })
          })
        })
      } else {
        log('warn', `Remote move [${label}]: no SSH client in pool, using SFTP rename`)
      }
      if (!result) {
        usedFallback = true
        result = await new Promise((resolve) => {
          sftp.rename(srcPath, dstPath, (err) => {
            if (err) return resolve({ ok: false, error: err.message })
            resolve({ ok: true })
          })
        })
      }
      if (result.ok) {
        log('info', `Remote move [${label}] (${usedFallback ? 'sftp rename' : 'ssh mv'}): ${srcPath} -> ${dstPath}`)
        const name   = dstPath.split('/').pop()
        const dstDir = dstPath.slice(0, dstPath.lastIndexOf('/')) || '/'
        const srcDir = srcPath.slice(0, srcPath.lastIndexOf('/')) || '/'
        if (srcDir === dstDir) {
          emitActivity({ type: 'rename', connectionId, payload: { oldName: srcPath.split('/').pop(), newName: name, dir: dstDir } })
        } else {
          let isDir = false
          try { isDir = await new Promise((res) => sftp.stat(dstPath, (e, st) => res(!e && st.isDirectory()))) } catch { /* default file */ }
          emitActivity({ type: 'move', connectionId, payload: { name, srcDir, dstDir, isDir } })
        }
      } else {
        log('error', `Remote move failed [${label}] from: ${srcPath}`)
        log('error', `Remote move failed [${label}]   to: ${dstPath} — ${result.error}`)
        emitActivity({ type: 'move', connectionId, level: 'error', error: result.error })
      }
      return result
    } catch (err) {
      const label = await _connLabel(connectionId)
      log('error', `Remote move/rename failed [${label}] from: ${srcPath}`)
      log('error', `Remote move/rename failed [${label}]   to: ${dstPath} — ${err.message}`)
      emitActivity({ type: 'move', connectionId, level: 'error', error: err.message })
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('remote:mkdir', async (_e, connectionId, remotePath) => {
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const result = await new Promise((resolve) => {
        sftp.mkdir(remotePath, (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true })
        })
      })
      if (result.ok) {
        log('info', `Remote directory created [${await _connLabel(connectionId)}]: ${remotePath}`)
        emitActivity({
          type: 'mkdir', connectionId,
          payload: { name: remotePath.split('/').pop(), parentDir: remotePath.slice(0, remotePath.lastIndexOf('/')) || '/' },
        })
      } else {
        log('error', `Remote mkdir failed [${await _connLabel(connectionId)}]: ${remotePath} — ${result.error}`)
        emitActivity({ type: 'mkdir', connectionId, level: 'error', error: result.error })
      }
      return result
    } catch (err) {
      log('error', `Remote mkdir failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
      emitActivity({ type: 'mkdir', connectionId, level: 'error', error: err.message })
      return { ok: false, error: err.message }
    }
  })

  // -- Remote: check which local files exist on NAS (no deletion) -------------
  ipcMain.handle('remote:verify-clean', async (_e, connectionId, localFolder) => {
    try {
      let localFiles
      try {
        localFiles = await walkLocal(localFolder)
      } catch (e) {
        return { ok: false, error: `Cannot read local folder: ${e.message}` }
      }

      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)

      const conn = await _getConnConfig(connectionId)
      const remoteBase = (conn?.sftp?.remotePath || '').replace(/\/+$/, '')

      const confirmed = []
      const notFound  = []

      for (const localFile of localFiles) {
        const rel = relative(localFolder, localFile).replace(/\\/g, '/')
        const remotePath = remoteBase ? `${remoteBase}/${rel}` : `/${rel}`
        try {
          await new Promise((res, rej) =>
            sftp.stat(remotePath, (e) => e ? rej(e) : res())
          )
          confirmed.push(rel)
        } catch {
          notFound.push(rel)
        }
      }

      return { ok: true, total: localFiles.length, confirmed, notFound }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- Remote: delete a list of local files after user confirmation ----------
  ipcMain.handle('remote:verify-delete', async (_e, localFolder, relPaths) => {
    try {
      if (!localFolder) return { ok: false, error: 'No local folder specified.' }
      const resolvedLF = resolve(localFolder)
      // Block drive roots (e.g. C:\, D:\, /)
      if (/^[A-Za-z]:\\?$/.test(resolvedLF) || resolvedLF === '/') {
        return { ok: false, error: 'Refusing to delete from a drive root.' }
      }

      let deleted = 0
      const errors = []
      for (const rel of relPaths) {
        const abs = join(resolvedLF, rel)
        // Path traversal guard
        if (!abs.startsWith(resolvedLF + sep)) {
          errors.push({ file: rel, error: 'Path traversal blocked.' })
          continue
        }
        try {
          rmSync(abs)
          deleted++
          log('info', `Local file deleted: ${abs}`)
        } catch (e) {
          log('error', `Local delete failed: ${abs} — ${e.message}`)
          errors.push({ file: rel, error: e.message })
        }
      }
      return { ok: true, deleted, errors }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: write file content -----------------------------------
  ipcMain.handle('remote:write-file', async (_e, connectionId, remotePath, content) => {
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const result = await new Promise((resolve) => {
        sftp.writeFile(remotePath, content, (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true })
        })
      })
      if (result.ok) {
        log('info', `Remote file written [${await _connLabel(connectionId)}]: ${remotePath}`)
      } else {
        log('error', `Remote write failed [${await _connLabel(connectionId)}]: ${remotePath} — ${result.error}`)
      }
      return result
    } catch (err) {
      log('error', `Remote write failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: write binary file content (e.g. cropped image) --------
  ipcMain.handle('remote:write-file-binary', async (_e, connectionId, remotePath, data, opts = {}) => {
    if (typeof connectionId !== 'string' || !connectionId) return { ok: false, error: 'Invalid connection' }
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
    const buf = Buffer.isBuffer(data) ? data
              : data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
              : data instanceof ArrayBuffer ? Buffer.from(data)
              : null
    if (!buf) return { ok: false, error: 'Invalid payload' }
    if (buf.length === 0) return { ok: false, error: 'Empty payload' }
    if (buf.length > 100 * 1024 * 1024) return { ok: false, error: 'Payload too large (max 100 MB)' }

    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)

      const writeOpts = { flag: 'w', mode: 0o644 }
      const target = opts?.atomic ? `${remotePath}.winraid-tmp-${process.pid}-${Date.now()}` : remotePath

      const written = await new Promise((resolve) => {
        sftp.writeFile(target, buf, writeOpts, (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true })
        })
      })
      if (!written.ok) {
        if (opts?.atomic) sftp.unlink(target, () => {})
        log('error', `Remote binary write failed [${await _connLabel(connectionId)}]: ${remotePath} — ${written.error}`)
        return written
      }

      if (opts?.atomic) {
        const renamed = await new Promise((resolve) => {
          sftp.rename(target, remotePath, (err) => {
            if (!err) return resolve({ ok: true })
            // Some servers reject rename when target exists — unlink + rename
            sftp.unlink(remotePath, (unlinkErr) => {
              if (unlinkErr) {
                sftp.unlink(target, () => {})
                return resolve({ ok: false, error: unlinkErr.message })
              }
              sftp.rename(target, remotePath, (err2) => {
                if (err2) {
                  sftp.unlink(target, () => {})
                  return resolve({ ok: false, error: err2.message })
                }
                resolve({ ok: true })
              })
            })
          })
        })
        if (!renamed.ok) {
          log('error', `Remote binary rename failed [${await _connLabel(connectionId)}]: ${remotePath} — ${renamed.error}`)
          return renamed
        }
      }

      _poolTouch(connectionId)
      log('info', `Remote binary written [${await _connLabel(connectionId)}]: ${remotePath} (${buf.length} bytes)`)
      return { ok: true }
    } catch (err) {
      log('error', `Remote binary write failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // -- Remote: disk usage via `df -P -k` over SSH exec -----------------------
  ipcMain.handle('remote:disk-usage', async (_e, connectionId) => {
    try {
      const conn = await _getConnConfig(connectionId)
      if (!conn) return { ok: false, error: 'Connection not found' }
      if (conn.type !== 'sftp') return { ok: false, error: 'Disk usage only available for SFTP connections' }

      await _poolGet(connectionId)   // ensure connection is established
      _poolTouch(connectionId)

      const poolEntry = _sftpPool.get(connectionId)
      if (!poolEntry) return { ok: false, error: 'Connection unavailable' }

      const remotePath = conn.sftp?.remotePath || '/'
      // Single-quote the path and escape any literal single quotes inside it
      const quotedPath = `'${remotePath.replace(/'/g, "'\\''")}'`

      let dfOutput
      try {
        const { stdout } = await execWithTimeout(poolEntry.client, `df -P -k -- ${quotedPath}`, 60_000)
        dfOutput = stdout
      } catch (err) {
        const label = await _connLabel(connectionId)
        log('error', `Remote disk usage failed [${label}]: ${err.message}`)
        return { ok: false, error: err.message }
      }

      // df -P output: one header line then one data line per filesystem
      // Columns: Filesystem  1024-blocks  Used  Available  Capacity%  Mounted-on
      const lines = dfOutput.trim().split('\n').filter(Boolean)
      const dataLine = lines[lines.length - 1]
      if (!dataLine) return { ok: false, error: 'Empty df output' }
      const parts = dataLine.trim().split(/\s+/)
      if (parts.length < 5) return { ok: false, error: 'Unexpected df output format' }
      const total = parseInt(parts[1], 10) * 1024
      const used  = parseInt(parts[2], 10) * 1024
      const free  = parseInt(parts[3], 10) * 1024
      if (isNaN(total) || isNaN(used) || isNaN(free)) {
        return { ok: false, error: 'Could not parse df output' }
      }
      const label = await _connLabel(connectionId)
      log('info', `Remote disk usage [${label}]: ${(free / 1024 ** 3).toFixed(1)} GB free of ${(total / 1024 ** 3).toFixed(1)} GB`)
      return { ok: true, total, used, free }
    } catch (err) {
      log('error', `Remote disk usage failed [${connectionId}]: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // -- Trim engine: NAS ffmpeg, local ffmpeg, or none ------------------------
  // 'server' trims on the NAS over SSH (no data transfer); 'local' downloads
  // the file, cuts it on this PC and uploads the result; 'none' means the
  // renderer should offer to download or locate a local ffmpeg.
  let _localFfmpegPath = null
  let _ffmpegDownloadPromise = null

  async function _resolveLocalFfmpeg() {
    if (_localFfmpegPath) return _localFfmpegPath
    const { getConfig } = await import('./config.js')
    const local = await findLocalFfmpeg({
      dataDir: app.getPath('userData'),
      customPath: getConfig('trimFfmpegPath'),
    })
    if (local) _localFfmpegPath = local.path
    return local ? local.path : null
  }

  ipcMain.handle('trim:capability', async (_e, connectionId) => {
    try {
      const conn = await _getConnConfig(connectionId)
      if (!conn) return { ok: false, error: 'Connection not found' }
      if (conn.type !== 'sftp') return { ok: false, error: 'Trim is only available for SFTP connections' }

      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const client = _sftpPool.get(connectionId)?.client
      if (!client) return { ok: false, error: 'Connection unavailable' }

      // A cached negative would outlive an ffmpeg install on the NAS; the
      // probe only runs on a Trim click, so re-checking negatives is cheap.
      if (_ffmpegCache.get(connectionId)?.available === false) _ffmpegCache.delete(connectionId)

      const probe = await _detectFfmpeg(connectionId, client)
      if (probe.available) return { ok: true, mode: 'server', version: probe.version }

      const localPath = await _resolveLocalFfmpeg()
      if (localPath) return { ok: true, mode: 'local' }
      return { ok: true, mode: 'none' }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('trim:download-ffmpeg', async () => {
    if (!_ffmpegDownloadPromise) {
      _ffmpegDownloadPromise = downloadFfmpeg({
        dataDir: app.getPath('userData'),
        request: (url) => net.request(url),
        onProgress: (pct) => mainWindow?.webContents.send('trim:download-progress', pct),
      })
      _ffmpegDownloadPromise.finally(() => { _ffmpegDownloadPromise = null })
    }
    const res = await _ffmpegDownloadPromise
    if (res.ok) {
      _localFfmpegPath = res.path
      log('info', `ffmpeg downloaded for local trims: ${res.path} (${res.version})`)
    } else {
      log('error', `ffmpeg download failed: ${res.error}`)
    }
    return res
  })

  ipcMain.handle('trim:locate-ffmpeg', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Locate ffmpeg',
      properties: ['openFile'],
      filters: [{ name: 'ffmpeg', extensions: ['exe'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: true, canceled: true }

    const chosen = result.filePaths[0]
    const probe = await validateFfmpegBinary(chosen)
    if (!probe.available) return { ok: false, error: 'That file did not run as ffmpeg' }

    const { setConfig } = await import('./config.js')
    setConfig('trimFfmpegPath', chosen)
    _localFfmpegPath = chosen
    log('info', `ffmpeg located by user for local trims: ${chosen} (${probe.version})`)
    return { ok: true, path: chosen, version: probe.version }
  })

  // Local-fallback trim: pull the source down, stream-copy on this PC with
  // the resolved local ffmpeg, push the cut back up, then finalize with the
  // same atomic sibling-move the server path uses.
  async function _localTrim({ connectionId, sftp, client, label, path, outPath, start, end }) {
    const slash = outPath.lastIndexOf('/')
    const dir   = slash > 0 ? outPath.slice(0, slash) : ''
    const dot   = outPath.lastIndexOf('.')
    const ext   = dot > slash ? outPath.slice(dot) : ''
    const remoteTmp = `${dir}/.winraid-trim-${Date.now()}${ext}`

    const workDir = join(tmpdir(), 'winraid-trim')
    mkdirSync(workDir, { recursive: true })
    const localIn  = join(workDir, `in-${Date.now()}${ext}`)
    const localOut = join(workDir, `out-${Date.now()}${ext}`)

    try {
      await new Promise((resolve, reject) => sftp.fastGet(path, localIn, (err) => (err ? reject(err) : resolve())))

      const args = ffmpegTrimArgs({ input: localIn, output: localOut, start, duration: end - start })
      await new Promise((resolve, reject) => {
        const proc = spawn(_localFfmpegPath, args, { windowsHide: true })
        let errTail = ''
        proc.stderr?.on('data', (chunk) => { errTail = (errTail + chunk).slice(-800) })
        proc.on('error', reject)
        proc.on('close', (code) => {
          if (code === 0) return resolve()
          const tail = errTail.trim().split('\n').slice(-3).join(' ').slice(0, 400)
          reject(new Error(tail || `ffmpeg exited ${code}`))
        })
      })

      await new Promise((resolve, reject) => sftp.fastPut(localOut, remoteTmp, (err) => (err ? reject(err) : resolve())))

      const mv = await execWithTimeout(client, `mv -f -- ${shQuote(remoteTmp)} ${shQuote(outPath)}`, 60_000)
      if (mv.code !== 0) {
        client.exec(`rm -f -- ${shQuote(remoteTmp)}`, () => {})
        return { ok: false, error: (mv.stderr || 'Could not finalize trimmed file').trim() }
      }

      log('info', `Video trimmed locally [${label}]: ${path} -> ${outPath} (${(end - start).toFixed(2)}s)`)
      emitActivity({
        type: 'upload', connectionId,
        payload: { name: outPath.split('/').pop(), destDir: dir || '/' },
      })
      return { ok: true, outPath }
    } catch (err) {
      client.exec(`rm -f -- ${shQuote(remoteTmp)}`, () => {})
      log('error', `Local video trim failed [${label}]: ${err.message}`)
      return { ok: false, error: err.message }
    } finally {
      rmSync(localIn, { force: true })
      rmSync(localOut, { force: true })
    }
  }

  // -- Remote: trim a video via ffmpeg stream-copy over SSH exec -------------
  ipcMain.handle('remote:trim-video', async (_e, connectionId, opts) => {
    const { path, outPath, start, end } = opts ?? {}
    if (!validateRemotePath(path) || !validateRemotePath(outPath)) return { ok: false, error: 'Invalid remote path' }
    if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end <= start) {
      return { ok: false, error: 'Invalid trim range' }
    }
    const label = await _connLabel(connectionId)
    try {
      const conn = await _getConnConfig(connectionId)
      if (!conn) return { ok: false, error: 'Connection not found' }
      if (conn.type !== 'sftp') return { ok: false, error: 'Trim is only available for SFTP connections' }

      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const client = _sftpPool.get(connectionId)?.client
      if (!client) return { ok: false, error: 'Connection unavailable' }

      const probe = await _detectFfmpeg(connectionId, client)
      if (!probe.available) {
        // No NAS ffmpeg: fall back to trimming on this PC. Join an in-flight
        // download if the user kicked one off from the trim-entry prompt.
        if (_ffmpegDownloadPromise) await _ffmpegDownloadPromise
        const localPath = await _resolveLocalFfmpeg()
        if (!localPath) return { ok: false, error: 'ffmpeg is not available on the NAS or this PC.' }
        return await _localTrim({ connectionId, sftp, client, label, path, outPath, start, end })
      }

      // Output to a temp sibling first — ffmpeg must not write the file it reads,
      // and a temp lets the final move be atomic.
      const slash = outPath.lastIndexOf('/')
      const dir   = slash > 0 ? outPath.slice(0, slash) : ''
      const dot   = outPath.lastIndexOf('.')
      const ext   = dot > slash ? outPath.slice(dot) : ''
      const tmp   = `${dir}/.winraid-trim-${Date.now()}${ext}`

      const duration = end - start
      const cmd = ffmpegTrimCommand({ input: path, output: tmp, start, duration })

      try {
        const { code, stderr } = await execWithTimeout(client, cmd, 600_000)
        if (code !== 0) {
          const tail = (stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 400)
          log('error', `Video trim failed [${label}]: ffmpeg exited ${code} — ${tail}`)
          client.exec(`rm -f -- ${shQuote(tmp)}`, () => {})
          return { ok: false, error: tail || `ffmpeg exited ${code}` }
        }

        // Move temp -> final. mv -f overwrites (SFTP rename does not, by spec),
        // and tmp is a sibling so the move stays on one filesystem (atomic).
        const mv = await execWithTimeout(client, `mv -f -- ${shQuote(tmp)} ${shQuote(outPath)}`, 60_000)
        if (mv.code !== 0) {
          client.exec(`rm -f -- ${shQuote(tmp)}`, () => {})
          return { ok: false, error: (mv.stderr || 'Could not finalize trimmed file').trim() }
        }

        log('info', `Video trimmed [${label}]: ${path} -> ${outPath} (${duration.toFixed(2)}s)`)
        emitActivity({
          type: 'upload', connectionId,
          payload: { name: outPath.split('/').pop(), destDir: dir || '/' },
        })
        return { ok: true, outPath }
      } catch (err) {
        client.exec(`rm -f -- ${shQuote(tmp)}`, () => {})
        throw err
      }
    } catch (err) {
      log('error', `Video trim failed [${label}]: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // ---------------------------------------------------------------------------
  // Remote: folder size scan — shallow (top level), parallel, streaming.
  // Children appear immediately; each subfolder's recursive size streams in as
  // the detected sizing tool (diskus if present, else du) returns. Deeper
  // levels load on demand via remote:size-scan-subtree.
  // ---------------------------------------------------------------------------

  ipcMain.handle('remote:size-scan', async (_e, connectionId) => {
    try {
      if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false, error: 'Invalid connectionId' }
      const existing = _sizeScans.get(connectionId)
      if (existing) existing.cancelled = true
      const conn = await _getConnConfig(connectionId)
      if (!conn) return { ok: false, error: 'Connection not found' }
      if (conn.type !== 'sftp') return { ok: false, error: 'Size scan only available for SFTP connections' }

      const sftp = await _poolGet(connectionId)
      _poolTouch(connectionId)
      const poolEntry = _sftpPool.get(connectionId)
      if (!poolEntry || !sftp) return { ok: false, error: 'Connection unavailable' }

      const scanState = { cancelled: false }
      _sizeScans.set(connectionId, scanState)
      const isActive = () => _sizeScans.get(connectionId) === scanState
      const isCancelled = () => scanState.cancelled

      const rootPath  = (conn.sftp?.remotePath || '/').replace(/\/+$/, '') || '/'
      const startTime = Date.now()
      const tool = await _detectSizeTool(connectionId, poolEntry.client)

      // Liveness heartbeat so the renderer's no-progress watchdog measures
      // "still working" rather than "level completed".
      let lastCount = 0
      let lastPath  = rootPath
      const keepAlive = setInterval(() => {
        _poolTouch(connectionId)
        if (isActive() && !isCancelled()) {
          sendToRenderer('size:progress', { connectionId, path: lastPath, count: lastCount, elapsedMs: Date.now() - startTime })
        }
      }, 10_000)

      try {
        const totalFolders = await _scanSizeLevel({
          client: poolEntry.client,
          sftp,
          connectionId,
          dirPath: rootPath,
          tool,
          concurrency: 6,
          isCancelled,
          isActive,
          onProgress: (path, count) => {
            lastCount = count
            lastPath  = path
            sendToRenderer('size:progress', { connectionId, path, count, elapsedMs: Date.now() - startTime })
          },
        })

        if (!scanState.cancelled && isActive()) {
          sendToRenderer('size:done', { connectionId, totalFolders, elapsedMs: Date.now() - startTime })
        }
      } finally {
        clearInterval(keepAlive)
      }

      _sizeScans.delete(connectionId)
      return { ok: true }
    } catch (err) {
      _sizeScans.delete(connectionId)
      sendToRenderer('size:error', { connectionId, error: err.message })
      log('error', `Size scan failed [${connectionId}]: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // On-demand drill: scans a single subtree without touching the existing
  // scan state, so the renderer can lazily expand a node the user just
  // clicked. The size:level events merge into the existing tree on the
  // renderer side via the parentPath key. No size:done is emitted —
  // the renderer is already in RESULTS phase.
  ipcMain.handle('remote:size-scan-subtree', async (_e, connectionId, subRoot) => {
    try {
      if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false, error: 'Invalid connectionId' }
      if (typeof subRoot !== 'string' || !subRoot.trim()) return { ok: false, error: 'Invalid subRoot' }
      if (!validateRemotePath(subRoot)) return { ok: false, error: 'Invalid remote path' }
      const conn = await _getConnConfig(connectionId)
      if (!conn) return { ok: false, error: 'Connection not found' }
      if (conn.type !== 'sftp') return { ok: false, error: 'Only SFTP supported' }

      const sftp = await _poolGet(connectionId)
      _poolTouch(connectionId)
      const poolEntry = _sftpPool.get(connectionId)
      if (!poolEntry || !sftp) return { ok: false, error: 'Connection unavailable' }

      const tool = await _detectSizeTool(connectionId, poolEntry.client)
      const keepAlive = setInterval(() => _poolTouch(connectionId), 10_000)
      try {
        await _scanSizeLevel({
          client: poolEntry.client,
          sftp,
          connectionId,
          dirPath: subRoot.replace(/\/+$/, '') || '/',
          tool,
          concurrency: 6,
          isCancelled: () => false,
        })
      } finally {
        clearInterval(keepAlive)
      }
      return { ok: true }
    } catch (err) {
      log('error', `[size-scan-subtree] failed: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('remote:size-cancel', (_e, connectionId) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false }
    }
    const scanState = _sizeScans.get(connectionId)
    if (scanState) scanState.cancelled = true
    return { ok: true }
  })

  // ---------------------------------------------------------------------------
  // Remote: media scan — BFS walk emitting image/video paths
  // ---------------------------------------------------------------------------

  ipcMain.handle('remote:media-scan', async (_e, connectionId, remotePath, opts) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false, error: 'Invalid connectionId' }
    }
    if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }

    const recursive = opts?.recursive !== false

    const existing = _mediaScans.get(connectionId)
    if (existing) existing.abort()

    const ac = new AbortController()
    _mediaScans.set(connectionId, ac)

    const sftp = await _poolGet(connectionId)
    if (!sftp) {
      _mediaScans.delete(connectionId)
      return { ok: false, error: 'Connection unavailable' }
    }
    _poolTouch(connectionId)

    const startTime = Date.now()
    let totalMatches = 0

    try {
      await mediaWalk(sftp, remotePath, {
        recursive,
        signal: ac.signal,
        onBatch(files) {
          if (_mediaScans.get(connectionId) !== ac) return
          totalMatches += files.length
          sendToRenderer('media:found', { files })
        },
        onError({ path, code, msg }) {
          if (_mediaScans.get(connectionId) !== ac) return
          sendToRenderer('media:error', { path, code, msg })
          log('warn', `media:scan dir error [${connectionId}] ${path}: ${msg}`)
        },
      })

      if (_mediaScans.get(connectionId) === ac) {
        sendToRenderer('media:done', { totalMatches, durationMs: Date.now() - startTime })
        _mediaScans.delete(connectionId)
      }
      return { ok: true }
    } catch (err) {
      if (_mediaScans.get(connectionId) === ac) _mediaScans.delete(connectionId)
      sendToRenderer('media:error', { path: remotePath, code: err.code, msg: err.message })
      log('error', `media:scan failed [${connectionId}]: ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('remote:media-cancel', (_e, connectionId) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false }
    const ac = _mediaScans.get(connectionId)
    if (ac) ac.abort()
    return { ok: true }
  })

  // -- Size scan cache (persist results across restarts) ---------------------
  const _sizeCacheFile = join(app.getPath('userData'), 'size-cache.json')

  function _readSizeCache() {
    try { return JSON.parse(readFileSync(_sizeCacheFile, 'utf8')) } catch { return {} }
  }

  ipcMain.handle('size:load-cache', (_e, connectionId) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) return null
    return _readSizeCache()[connectionId] ?? null
  })

  ipcMain.handle('size:save-cache', (_e, connectionId, data) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false }
    try {
      const all = _readSizeCache()
      all[connectionId] = data
      writeFileAsync(_sizeCacheFile, JSON.stringify(all)).catch((e) =>
        log('warn', `size cache write failed: ${e.message}`)
      )
      return { ok: true }
    } catch (e) {
      log('warn', `size cache save failed: ${e.message}`)
      return { ok: false }
    }
  })

  // -- Backup: NAS → local SFTP download -------------------------------------
  ipcMain.handle('backup:run', async (_e, cfg) => {
    // Per-run token: if a second run starts while one is in flight, the first
    // is superseded and will abort itself when it next checks the token.
    const myToken = {}
    if (_backupCurrentToken) _backupCurrentToken.cancelled = true
    _backupCurrentToken = myToken
    myToken.cancelled = false
    const stats = { files: 0, skipped: 0, bytes: 0, totalBytes: 0, errors: [] }

    // Validate the renderer-supplied localDest against the user home directory.
    // A renderer passing a broad path (e.g. C:\) would make the per-file
    // traversal guard inside the loop trivially pass for any file, so we
    // require localDest to be a subdirectory of home before proceeding.
    if (typeof cfg.localDest !== 'string' || !cfg.localDest.trim()) {
      return { ok: false, error: 'invalid destination' }
    }
    const homeDir      = app.getPath('home')
    const homePrefix   = homeDir.endsWith(sep) ? homeDir : homeDir + sep
    const resolvedDest = resolve(cfg.localDest)
    if (resolvedDest === homeDir || !resolvedDest.startsWith(homePrefix)) {
      return { ok: false, error: 'invalid destination' }
    }

    // Resolve the connection from the renderer-supplied connectionId
    const { connectionId } = cfg
    if (!connectionId || typeof connectionId !== 'string') {
      return { ok: false, error: 'connectionId is required.' }
    }
    const { getConfig } = await import('./config.js')
    const appCfg = getConfig()
    const activeConn = (appCfg.connections ?? []).find((c) => c.id === connectionId)
    if (!activeConn || activeConn.type !== 'sftp') {
      return { ok: false, error: 'No active SFTP connection configured.' }
    }
    const sftpCfg = activeConn.sftp

    const { Client } = await import('ssh2')
    let privateKey
    if (sftpCfg.keyPath) {
      const kp = sftpCfg.keyPath.startsWith('~')
        ? join(homedir(), sftpCfg.keyPath.slice(1).replace(/^[/\\]/, ''))
        : sftpCfg.keyPath
      try { privateKey = readFileSync(kp) }
      catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
    }

    let conn, sftp
    try {
      ({ conn, sftp } = await new Promise((resolve, reject) => {
        const c = new Client()
        c.on('ready', () =>
          c.sftp((err, s) => { if (err) { c.end(); reject(err) } else resolve({ conn: c, sftp: s }) })
        ).on('error', reject)
         .connect({
          host:         sftpCfg.host,
          port:         sftpCfg.port || 22,
          username:     sftpCfg.username,
          password:     sftpCfg.password?.trim() || undefined,
          privateKey:   privateKey || undefined,
          readyTimeout: 15_000,
        })
      }))
    } catch (err) {
      log('error', `Backup: SSH connection failed — ${err.message}`)
      return { ok: false, error: `SSH connection failed: ${err.message}` }
    }

    _backupCurrentConn = conn
    log('info', `Backup started — ${cfg.sources.length} source(s) → ${cfg.localDest}`)

    try {
      for (const sourcePath of cfg.sources) {
        if (myToken.cancelled) break

        log('info', `Backup: walking ${sourcePath}`)
        const baseName = sourcePath.split('/').filter(Boolean).pop() || 'backup'
        let files
        try {
          files = await backupWalkRemote(sftp, sourcePath, baseName)
          log('info', `Backup: ${files.length} file(s) found under ${sourcePath}`)
        } catch (e) {
          log('error', `Backup: failed to walk ${sourcePath} — ${e.message}`)
          stats.errors.push({ source: sourcePath, error: e.message })
          sendToRenderer('backup:progress', { file: null, stats })
          continue
        }

        for (const { remotePath, size, mtime, relPath } of files) {
          if (myToken.cancelled) break

          const localPath = join(cfg.localDest, ...relPath.split('/').filter(Boolean))

          // Guard against path traversal — resolved path must stay inside localDest
          const resolvedDest  = resolve(cfg.localDest)
          const resolvedLocal = resolve(localPath)
          if (!resolvedLocal.startsWith(resolvedDest + sep)) {
            log('warn', `Backup: blocked path traversal attempt: ${relPath}`)
            stats.errors.push({ file: relPath, error: 'Path outside destination — skipped.' })
            continue
          }

          // Incremental: skip files where local size and mtime both match remote.
          // When the server omits mtime (returns 0), fall back to size-only comparison.
          // Use 1-second tolerance for servers/filesystems that round mtime to 2s boundaries.
          try {
            const st = await statAsync(localPath)
            const localSec  = Math.floor(st.mtimeMs / 1000)
            const sizeMatch  = st.size === size
            const mtimeMatch = mtime === 0 || Math.abs(localSec - mtime) <= 1
            if (sizeMatch && mtimeMatch) {
              stats.skipped++
              sendToRenderer('backup:progress', { file: relPath, status: 'skipped', stats })
              continue
            }
            log('info', `Backup: re-downloading ${relPath} — local(size=${st.size} mtime=${localSec}) remote(size=${size} mtime=${mtime})`)
          } catch { /* file doesn't exist locally — proceed to download */ }

          try {
            await backupDownloadFile(sftp, remotePath, localPath)
            // Preserve remote mtime so the incremental skip logic works on the next run
            try { utimesSync(localPath, new Date(), new Date(mtime * 1000)) } catch { /* best effort */ }
            stats.files++
            stats.bytes += size
            log('info', `Backup: downloaded ${relPath}`)
            sendToRenderer('backup:progress', { file: relPath, status: 'done', stats })
          } catch (e) {
            log('error', `Backup: failed to download ${relPath} — ${e.message}`)
            stats.errors.push({ file: relPath, error: e.message })
            sendToRenderer('backup:progress', { file: relPath, status: 'error', stats })
            if (myToken.cancelled) {
              // Remove partial file left by interrupted fastGet
              await unlinkAsync(localPath).catch(() => {})
            }
          }
        }
      }
    } finally {
      _backupCurrentConn = null
      conn.end()
    }

    stats.totalBytes = await calcDirSize(cfg.localDest)
    sendToRenderer('backup:progress', { file: null, stats })

    if (myToken.cancelled) {
      log('warn', `Backup cancelled — ${stats.files} downloaded, ${stats.skipped} skipped, ${stats.errors.length} error(s)`)
    } else {
      log('info', `Backup complete — ${stats.files} downloaded, ${stats.skipped} skipped, ${stats.errors.length} error(s)`)
    }
    return { ok: true, stats }
  })

  ipcMain.handle('backup:cancel', () => {
    if (_backupCurrentToken) _backupCurrentToken.cancelled = true
    if (_backupCurrentConn) {
      try { _backupCurrentConn.end() } catch { /* already closed */ }
      _backupCurrentConn = null
    }
    return { ok: true }
  })

  // -- SSH: create remote directory (for the remote-path browser) -------------
  ipcMain.handle('ssh:mkdir', async (_e, cfg, dirPath) => {
    if (!dirPath || typeof dirPath !== 'string') return { ok: false, error: 'Invalid path' }
    try {
      validateCfg(cfg)
    } catch (err) {
      return { ok: false, error: err.message }
    }
    try {
      const { Client } = await import('ssh2')

      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try {
          privateKey = readFileSync(kp)
        } catch (e) {
          return { ok: false, error: `Cannot read key file: ${e.message}` }
        }
      }

      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp((err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }
              sftp.mkdir(dirPath, (err2) => {
                conn.end()
                if (err2) return resolve({ ok: false, error: err2.message })
                resolve({ ok: true })
              })
            })
          })
          .on('error', (err) => resolve({ ok: false, error: err.message }))
          .connect({
            host:         cfg.host,
            port:         cfg.port || 22,
            username:     cfg.username,
            password:     cfg.password?.trim() || undefined,
            privateKey:   privateKey || undefined,
            readyTimeout: 10_000,
          })
      })
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- SSH: list remote directory (for the remote-path browser) ---------------
  ipcMain.handle('ssh:list-dir', async (_e, cfg) => {
    try {
      validateCfg(cfg)
    } catch (err) {
      return { ok: false, error: err.message }
    }
    try {
      const { Client } = await import('ssh2')

      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try {
          privateKey = readFileSync(kp)
        } catch (e) {
          return { ok: false, error: `Cannot read key file: ${e.message}` }
        }
      }

      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp((err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }

              const dirPath = cfg.remotePath || '/'
              sftp.readdir(dirPath, (err, list) => {
                conn.end()
                if (err) return resolve({ ok: false, error: err.message })

                const entries = list
                  .map((e) => ({
                    name: e.filename,
                    type: ((e.attrs.mode ?? 0) & 0o170000) === 0o040000 ? 'dir' : 'file',
                  }))
                  .filter((e) => !e.name.startsWith('.'))   // hide dotfiles
                  .sort((a, b) => {
                    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
                    return a.name.localeCompare(b.name)
                  })

                resolve({ ok: true, entries })
              })
            })
          })
          .on('error', (err) => resolve({ ok: false, error: err.message }))
          .connect({
            host:         cfg.host,
            port:         cfg.port || 22,
            username:     cfg.username,
            password:     cfg.password?.trim() || undefined,
            privateKey:   privateKey || undefined,
            readyTimeout: 10_000,
          })
      })
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

// ---------------------------------------------------------------------------
// File-detected callback factory
// ---------------------------------------------------------------------------

/**
 * Returns a callback for the watcher that enqueues detected files under
 * the given connectionId. Each connection gets its own closure so that
 * the connectionId is baked in and not looked up at call time.
 *
 * @param {string} connectionId
 * @returns {(filePath: string, opts: { isInitial: boolean }) => Promise<void>}
 */
function isExtensionBlocked(filePath, conn) {
  const ext = extname(filePath).toLowerCase()
  if (conn.extensions?.length > 0 && !conn.extensions.includes(ext)) return true
  if (conn.ignoredExtensions?.length > 0 && conn.ignoredExtensions.includes(ext)) return true
  return false
}

function makeFileDetectedCallback(connectionId) {
  // Lazy-opened once per watcher start: a checker that probes individual
  // remote paths over a single persistent connection (SFTP) or UNC stat (SMB).
  let _checker = undefined  // undefined = not opened, null = open failed

  return async function onFileDetected(filePath, { isInitial = false } = {}) {
    const { getConfig } = await import('./config.js')
    const cfg  = getConfig()
    const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
    if (!conn) {
      log('warn', `File detected for unknown connection ${connectionId} — skipping`)
      return
    }

    if (isExtensionBlocked(filePath, conn)) {
      log('info', `Skipping (extension filtered) [${connectionId}]: ${filePath}`)
      return
    }

    const relPath = conn.folderMode === 'flat'
      ? basename(filePath)
      : relative(conn.localFolder, filePath).replace(/\\/g, '/')

    const q = await getQueue()

    // During the initial folder scan, skip files that are already in the
    // local queue OR already present on the remote (covers wiped queues).
    if (isInitial) {
      if (q.shouldSkipOnRescan(filePath, connectionId)) return

      // Open remote checker once per scan (lazy, per-connection)
      if (_checker === undefined) {
        _checker = await openRemoteCheckerForConn(conn)
        const { setWatcherChecker } = await import('./watcher.js')
        setWatcherChecker(connectionId, _checker ?? null)
      }
      if (_checker) {
        try {
          if (await _checker.exists(relPath)) {
            log('info', `Skipping (exists on remote) [${connectionId}]: ${relPath}`)
            return
          }
        } catch {
          // Connection dropped mid-scan — stop checking, let files queue normally
          _checker.close()
          _checker = null
          const { setWatcherChecker } = await import('./watcher.js')
          setWatcherChecker(connectionId, null)
        }
      }
    } else if (_checker) {
      // Initial scan is over — close the checker
      _checker.close()
      _checker = null
      const { setWatcherChecker } = await import('./watcher.js')
      setWatcherChecker(connectionId, null)
    }

    let fileSize = null
    try { fileSize = statSync(filePath).size } catch { /* file may have been removed */ }
    const jobId = q.enqueue(filePath, { relPath, operation: conn.operation, connectionId, size: fileSize })
    sendToRenderer('queue:updated', { type: 'added', jobId })

    try {
      const { ensureWorkerRunning } = await import('./worker.js')
      ensureWorkerRunning()
    } catch { /* worker may already be running */ }
  }
}

/**
 * Open a remote checker for a connection (single SFTP session or UNC stat).
 * Returns { exists(relPath): Promise<boolean>, close() } or null on failure.
 */
async function openRemoteCheckerForConn(conn) {
  try {
    if (conn.type === 'sftp') {
      const sftpCfg = { ...conn.sftp }
      // Decrypt password stored as enc:<base64> before opening the checker connection
      if (typeof sftpCfg.password === 'string' && sftpCfg.password.startsWith('enc:')) {
        const { safeStorage } = await import('electron')
        try {
          sftpCfg.password = safeStorage.decryptString(Buffer.from(sftpCfg.password.slice(4), 'base64'))
        } catch {
          sftpCfg.password = ''
        }
      }
      const { openRemoteChecker } = await import('./backends/sftp.js')
      return await openRemoteChecker(sftpCfg)
    }
    if (conn.type === 'smb') {
      const { openRemoteChecker } = await import('./backends/smb.js')
      return await openRemoteChecker(conn.smb)
    }
  } catch (err) {
    log('warn', `Could not open remote checker for [${conn.id}]: ${err.message}`)
  }
  return null
}

// ---------------------------------------------------------------------------
// Exports for worker / watcher
// ---------------------------------------------------------------------------
export function sendToRenderer(channel, payload) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

export function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show()
  }
}

// ---------------------------------------------------------------------------
// Auto-updater (production only)
// ---------------------------------------------------------------------------
let _autoUpdater = null
let _updaterUnavailableReason = null

function _sendUpdateStatus(status, info) {
  mainWindow?.webContents?.send('update:status', { status, ...info })
}

async function initAutoUpdater() {
  if (!app.isPackaged) {
    _updaterUnavailableReason = 'Not available in development mode'
    return
  }

  try {
    const mod = await import('electron-updater')
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater ?? mod.default
    if (!autoUpdater || typeof autoUpdater.checkForUpdates !== 'function') {
      throw new Error('electron-updater did not export autoUpdater')
    }
    _autoUpdater = autoUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      _sendUpdateStatus('checking')
      log('info', 'Updater: checking for updates...')
    })
    autoUpdater.on('update-available', (info) => {
      _sendUpdateStatus('available', { version: info.version })
      log('info', `Updater: update available — v${info.version}`)
    })
    autoUpdater.on('update-not-available', (info) => {
      _sendUpdateStatus('up-to-date', { version: info.version })
      log('info', 'Updater: already up to date.')
    })
    autoUpdater.on('download-progress', (progress) => {
      _sendUpdateStatus('downloading', { percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      _sendUpdateStatus('ready', { version: info.version })
      notify('WinRaid update ready', `v${info.version} — restart to apply.`)
      log('info', `Update downloaded: v${info.version}`)
    })
    autoUpdater.on('error', (err) => {
      _sendUpdateStatus('error', { error: err.message })
      log('error', `Updater: ${err.message}`)
    })

    autoUpdater.checkForUpdatesAndNotify()
  } catch (err) {
    _updaterUnavailableReason = `Updater failed to initialize: ${err.message}`
    log('error', `Auto-updater init failed: ${err.message}`)
  }
}

// IPC: manual update check + install
function registerUpdateIPC() {
  ipcMain.handle('update:check', async () => {
    if (!_autoUpdater) return { ok: false, error: _updaterUnavailableReason ?? 'Updater not available' }
    try {
      const result = await _autoUpdater.checkForUpdates()
      return { ok: true, version: result?.updateInfo?.version ?? null }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('update:install', () => {
    if (!_autoUpdater) return
    _autoUpdater.quitAndInstall(true, true)
  })
}


// ---------------------------------------------------------------------------
// nas-stream:// custom protocol — streams SFTP files to the renderer
// ---------------------------------------------------------------------------

// Map of file extension -> MIME type used in Content-Type headers.
const MIME_BY_EXT = {
  // Images
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  gif:  'image/gif',
  webp: 'image/webp',
  svg:  'image/svg+xml',
  bmp:  'image/bmp',
  // Video
  mp4:  'video/mp4',
  m4v:  'video/mp4',
  webm: 'video/webm',
  mov:  'video/quicktime',
  mkv:  'video/x-matroska',
  // Audio
  mp3:  'audio/mpeg',
  flac: 'audio/flac',
  wav:  'audio/wav',
  aac:  'audio/aac',
  ogg:  'audio/ogg',
  m4a:  'audio/mp4',
  opus: 'audio/ogg; codecs=opus',
  // Documents
  pdf:  'application/pdf',
  // Text / code
  txt:  'text/plain; charset=utf-8',
  json: 'application/json',
  xml:  'application/xml',
}

function mimeForPath(filePath) {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  const ext = filePath.slice(dot + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

// SFTP connection pool — reuses live connections for all remote operations.
// Entry shape: { client: Client, sftp: SFTPWrapper, timer: NodeJS.Timeout }
const _sftpPool = new Map()
const _sftpPoolPending = new Map()  // concurrency guard: connId → Promise
const SFTP_POOL_TTL = 30_000  // 30 s idle before closing

function _poolTouch(connId) {
  const entry = _sftpPool.get(connId)
  if (!entry) return
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    const e = _sftpPool.get(connId)
    if (e) {
      try { e.client.end() } catch { /* best effort */ }
      _sftpPool.delete(connId)
    }
  }, SFTP_POOL_TTL)
}

async function _poolGet(connId) {
  const existing = _sftpPool.get(connId)
  if (existing) {
    _poolTouch(connId)
    return existing.sftp
  }

  // Concurrency guard — if another call is already connecting, wait for it
  const pending = _sftpPoolPending.get(connId)
  if (pending) {
    await pending
    const entry = _sftpPool.get(connId)
    if (entry) { _poolTouch(connId); return entry.sftp }
    return null
  }

  const connectPromise = _poolConnect(connId)
  _sftpPoolPending.set(connId, connectPromise)
  try {
    return await connectPromise
  } finally {
    _sftpPoolPending.delete(connId)
  }
}

async function _poolConnect(connId) {
  // Look up connection config
  const { getConfig } = await import('./config.js')
  const appCfg = getConfig()
  const conn = (appCfg.connections ?? []).find((c) => c.id === connId)
  if (!conn || conn.type !== 'sftp') return null

  const sftpCfg = conn.sftp
  const { Client } = await import('ssh2')

  let privateKey
  if (sftpCfg?.keyPath) {
    const kp = sftpCfg.keyPath.startsWith('~')
      ? join(homedir(), sftpCfg.keyPath.slice(1).replace(/^[/\\]/, ''))
      : sftpCfg.keyPath
    try { privateKey = readFileSync(kp) }
    catch { return null }
  }

  // Decrypt password if stored encrypted
  let password = sftpCfg?.password ?? ''
  if (typeof password === 'string' && password.startsWith('enc:')) {
    const { safeStorage } = await import('electron')
    try {
      password = safeStorage.decryptString(Buffer.from(password.slice(4), 'base64'))
    } catch {
      password = ''
    }
  }

  return new Promise((resolve) => {
    const client = new Client()
    client
      .on('ready', () => {
        client.sftp((err, sftpHandle) => {
          if (err) {
            client.end()
            return resolve(null)
          }
          const timer = setTimeout(() => {
            try { client.end() } catch { /* best effort */ }
            _sftpPool.delete(connId)
          }, SFTP_POOL_TTL)
          _sftpPool.set(connId, { client, sftp: sftpHandle, timer })
          client.on('close', () => _sftpPool.delete(connId))
          client.on('error', () => _sftpPool.delete(connId))
          resolve(sftpHandle)
        })
      })
      .on('error', () => resolve(null))
      .connect({
        host:         sftpCfg.host,
        port:         sftpCfg.port || 22,
        username:     sftpCfg.username,
        password:     password?.trim() || undefined,
        privateKey:   privateKey || undefined,
        readyTimeout: 15_000,
      })
  })
}

/** Look up a connection's config from the config store. */
async function _getConnConfig(connId) {
  const { getConfig } = await import('./config.js')
  return (getConfig().connections ?? []).find((c) => c.id === connId) ?? null
}

async function _connLabel(connId) {
  try {
    const { getConfig } = await import('./config.js')
    const conn = (getConfig().connections ?? []).find((c) => c.id === connId)
    return conn?.name ?? connId
  } catch {
    return connId
  }
}

// Push a structured activity entry for a user-facing op. Success uses the
// describeActivity mapping; failure uses a short failure title + the error text
// and is never clickable. connectionId travels raw — the renderer resolves the
// connection name/icon for the pill.
function emitActivity({ type, connectionId, payload = {}, level = 'info', error }) {
  if (level === 'error') {
    pushActivity({ type, level, connectionId, title: failureTitle(type), detail: error, nav: null })
  } else {
    const { title, detail, nav } = describeActivity(type, payload)
    pushActivity({ type, level, connectionId, title, detail, nav })
  }
}

// Parse a Range header value like "bytes=0-1023".
// Returns { start, end } or null if the header is absent or unparseable.
function parseRange(rangeHeader, fileSize) {
  if (!rangeHeader) return null
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
  if (!m) return null
  const start = m[1] ? parseInt(m[1], 10) : 0
  const end   = m[2] ? parseInt(m[2], 10) : fileSize - 1
  if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) return null
  return { start, end }
}

// Wraps a Node.js Readable into a Web ReadableStream safe for use in
// Electron protocol handlers. The `cancelled` flag prevents controller calls
// (enqueue / close / error) after Chromium cancels the request — calling any
// controller method on a cancelled stream throws a TypeError that crosses the
// JS/C++ boundary and causes a dangling raw_ptr crash in the renderer process.
function nodeStreamToReadable(nodeStream) {
  let cancelled = false
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data',  (chunk) => { if (!cancelled) controller.enqueue(chunk) })
      nodeStream.on('end',   ()      => { if (!cancelled) controller.close() })
      nodeStream.on('error', (err)   => { if (!cancelled) controller.error(err) })
    },
    cancel() { cancelled = true; nodeStream.destroy() },
  })
}

/**
 * Wraps a Node.js readable stream in a WHATWG ReadableStream, forwarding
 * chunks to the controller immediately (so the browser gets bytes as they
 * arrive), while simultaneously collecting chunks for a side-effect cache
 * write that fires after the stream ends.
 *
 * onCached(buf) is called once with the full buffer when the stream ends.
 * It is NOT called if the stream is cancelled or errors.
 */
function nodeStreamToReadableWithCache(nodeStream, onCached) {
  let cancelled = false
  const chunks  = []
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        if (cancelled) return
        chunks.push(chunk)
        controller.enqueue(chunk)
      })
      nodeStream.on('end', () => {
        if (cancelled) return
        controller.close()
        onCached(Buffer.concat(chunks))
      })
      nodeStream.on('error', (err) => {
        if (!cancelled) controller.error(err)
      })
    },
    cancel() {
      cancelled = true
      nodeStream.destroy()
    },
  })
}

// Returns the absolute path where a thumbnail JPEG for remotePath should be
// stored under userData/thumbs/{connId}/{sha256(remotePath)}.jpg
function thumbCachePath(connId, remotePath) {
  const hash = createHash('sha256').update(remotePath).digest('hex')
  return join(app.getPath('userData'), 'thumbs', connId, hash + '.jpg')
}

// Returns the absolute path for the full-resolution cached copy of remotePath,
// stored under userData/thumbs/{connId}/full/{sha256(remotePath)}.{ext}
function fullCachePath(connId, remotePath) {
  const hash = createHash('sha256').update(remotePath).digest('hex')
  const ext  = extname(remotePath) || ''
  return join(app.getPath('userData'), 'thumbs', connId, 'full', hash + ext)
}

// Thumbnail concurrency semaphore — cap simultaneous SFTP thumbnail downloads
// so the SSH connection isn't saturated by 20+ parallel reads when a large
// image folder is opened.
class _Semaphore {
  constructor(n) { this._n = n; this._q = [] }
  acquire() {
    if (this._n > 0) { this._n--; return Promise.resolve() }
    return new Promise((r) => this._q.push(r))
  }
  release() { if (this._q.length > 0) this._q.shift()(); else this._n++ }
}
const _thumbSem = new _Semaphore(4)

// Run the synchronous nativeImage decode → resize → JPEG encode in the next
// iteration of the event loop so that IPC and other async work can interleave
// between thumbnail processing steps.
function _nativeImageToJpeg(buf) {
  return new Promise((resolve) => {
    setImmediate(() => {
      try {
        const img = nativeImage.createFromBuffer(buf)
        if (img.isEmpty()) return resolve(null)
        resolve(img.resize({ width: 240 }).toJPEG(80))
      } catch {
        // Undecodable by nativeImage (e.g. webp/svg on platforms it can't
        // rasterize, which can throw rather than return empty). Signal "no
        // thumbnail" so the caller serves the original bytes — the renderer's
        // <img> handles webp/gif/svg natively — instead of failing with a 500.
        resolve(null)
      }
    })
  })
}

function registerNasStreamProtocol() {
  // Privilege must be declared before app.whenReady() — done in the
  // protocol.registerSchemesAsPrivileged call below at module level.
  protocol.handle('nas-stream', async (request) => {
    try {
      const url = new URL(request.url)
      // hostname is the connectionId; pathname is the remote file path
      const connId     = url.hostname
      const remotePath = decodeURIComponent(url.pathname)

      if (!connId || !validateRemotePath(remotePath)) {
        return new Response('Bad Request', { status: 400 })
      }

      // Renderer cancelled (e.g. the row scrolled out of the virtualized grid).
      // Bail before doing any SFTP work so we don't waste a thumbnail slot.
      if (request.signal?.aborted) return new Response(null, { status: 499 })

      const sftp = await _poolGet(connId)
      if (!sftp) {
        return new Response('Connection not found or unavailable', { status: 404 })
      }
      _poolTouch(connId)

      const mime        = mimeForPath(remotePath)
      const rangeHeader = request.headers.get('range')
      const isThumb     = url.searchParams.get('thumb') === '1'
      const CACHE       = 'private, max-age=300'

      // Range request — stat first to validate bounds and build Content-Range
      if (rangeHeader) {
        const attrs = await new Promise((res, rej) =>
          sftp.stat(remotePath, (err, a) => err ? rej(err) : res(a))
        ).catch(() => null)

        if (!attrs) return new Response('File not found', { status: 404 })

        const fileSize = attrs.size ?? 0
        const range    = parseRange(rangeHeader, fileSize)
        if (!range) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}` },
          })
        }
        const { start, end } = range
        const chunkSize = end - start + 1

        const stream = sftp.createReadStream(remotePath, { start, end })
        const body   = nodeStreamToReadable(stream)

        return new Response(body, {
          status: 206,
          headers: {
            'Content-Type':   mime,
            'Content-Length': String(chunkSize),
            'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges':  'bytes',
            'Cache-Control':  CACHE,
          },
        })
      }

      // No Range + image thumbnail — serve from disk cache (resize on first hit)
      if (mime.startsWith('image/') && isThumb) {
        const cachePath = thumbCachePath(connId, remotePath)

        // Cache hit — serve without touching SFTP
        const cached = await readFileAsync(cachePath).catch(() => null)
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: {
              'Content-Type':  'image/jpeg',
              'Cache-Control': CACHE,
            },
          })
        }

        // Cache miss — limit to 4 concurrent SFTP thumbnail downloads so the
        // SSH connection isn't overwhelmed by large folders.
        await _thumbSem.acquire()
        let buf
        try {
          // If the request was cancelled while queued (fast scroll), skip the
          // download so the freed slot goes to a thumbnail that's still on screen.
          if (request.signal?.aborted) return new Response(null, { status: 499 })

          const stream = sftp.createReadStream(remotePath)
          const chunks = []
          await new Promise((resolve, reject) => {
            const onAbort = () => { stream.destroy(); reject(new Error('aborted')) }
            request.signal?.addEventListener('abort', onAbort, { once: true })
            const cleanup = () => request.signal?.removeEventListener('abort', onAbort)
            stream.on('data',  (chunk) => chunks.push(chunk))
            stream.on('end',   () => { cleanup(); resolve() })
            stream.on('error', (e) => { cleanup(); reject(e) })
          })
          buf = Buffer.concat(chunks)
        } finally {
          _thumbSem.release()
        }

        // Save full-res copy so QuickLook can serve it without re-fetching
        const fcp     = fullCachePath(connId, remotePath)
        const fullDir = join(app.getPath('userData'), 'thumbs', connId, 'full')
        await mkdirAsync(fullDir, { recursive: true })
        await writeFileAsync(fcp, buf).catch(() => {})

        // nativeImage decode + resize runs in the next event-loop tick so IPC
        // and other work can interleave between thumbnail processing steps.
        const jpegBuf = await _nativeImageToJpeg(buf)
        if (!jpegBuf) {
          // nativeImage could not rasterize this format (e.g. webp/svg) — serve
          // the original bytes as-is; the renderer's <img> handles them natively.
          log('info', `[thumb] nativeImage could not rasterize ${mime}, serving original — ${remotePath}`)
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type':  mime,
              'Cache-Control': CACHE,
            },
          })
        }

        const cacheDir = join(app.getPath('userData'), 'thumbs', connId)
        await mkdirAsync(cacheDir, { recursive: true })
        await writeFileAsync(cachePath, jpegBuf).catch(() => {})

        return new Response(jpegBuf, {
          status: 200,
          headers: {
            'Content-Type':  'image/jpeg',
            'Cache-Control': CACHE,
          },
        })
      }

      // No Range + full file (full-res image or non-image)
      // Check the full-res disk cache first; on a miss, buffer from SFTP,
      // persist both the full-res copy and (if absent) the thumbnail, then serve.
      // If the request URL has ?bust=..., invalidate the disk cache so we read
      // fresh bytes (used after overwrite-saves like the crop feature).
      const bustRequest = url.searchParams.has('bust')
      const fcp    = fullCachePath(connId, remotePath)
      if (bustRequest) {
        await unlinkAsync(fcp).catch(() => {})
      }
      const cached = bustRequest ? null : await readFileAsync(fcp).catch(() => null)
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            'Content-Type':   mime,
            'Content-Length': String(cached.length),
            'Accept-Ranges':  'bytes',
            'Cache-Control':  CACHE,
          },
        })
      }

      const readStream = sftp.createReadStream(remotePath)
      const body = nodeStreamToReadableWithCache(readStream, async (buf) => {
        try {
          const fullDir = join(app.getPath('userData'), 'thumbs', connId, 'full')
          await mkdirAsync(fullDir, { recursive: true })
          await writeFileAsync(fcp, buf).catch(() => {})

          // Populate thumbnail cache if this is an image and the thumb is missing
          if (mime.startsWith('image/')) {
            const tcp = thumbCachePath(connId, remotePath)
            const hasThumb = await accessAsync(tcp).then(() => true).catch(() => false)
            if (!hasThumb) {
              const img = nativeImage.createFromBuffer(buf)
              if (!img.isEmpty()) {
                const thumbDir = join(app.getPath('userData'), 'thumbs', connId)
                await mkdirAsync(thumbDir, { recursive: true })
                await writeFileAsync(tcp, img.resize({ width: 240 }).toJPEG(80)).catch(() => {})
              }
            }
          }
        } catch { /* cache write failure is non-fatal */ }
      })

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type':  mime,
          'Accept-Ranges': 'bytes',
          'Cache-Control': CACHE,
        },
      })
    } catch (err) {
      // Cancelled requests (scrolled-past thumbnails) are expected — not errors.
      if (request.signal?.aborted || err?.message === 'aborted') {
        return new Response(null, { status: 499 })
      }
      const url2 = new URL(request.url)
      log('error', `nas-stream error [${url2.hostname}] ${decodeURIComponent(url2.pathname)} — ${err.message}`)
      return new Response('Internal Server Error', { status: 500 })
    }
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  // Inject a Content Security Policy for the renderer via the session layer.
  // Production uses a strict policy; dev relaxes script-src so Vite HMR works.
  // The dashboard-icons feature (ConnectionIcon.jsx / IconPicker.jsx) is the
  // only thing that needs external hosts: <img> tags load SVGs from the
  // jsdelivr CDN, and IconPicker fetches the icon metadata JSON from
  // raw.githubusercontent.com. Both are pinned to their exact path/prefix
  // rather than whitelisting the bare host, and scoped to the directive the
  // feature actually uses (img-src for the CDN images, connect-src for the
  // metadata fetch) — neither host is needed in the other directive.
  const DASHBOARD_ICONS_CDN_PREFIX = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/'
  const DASHBOARD_ICONS_METADATA_URL = 'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/metadata.json'

  const csp = app.isPackaged
    ? "default-src 'self' nas-stream:; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      `img-src 'self' data: blob: nas-stream: ${DASHBOARD_ICONS_CDN_PREFIX}; ` +
      "media-src 'self' nas-stream:; " +
      // frame-src/object-src don't inherit reliably for the PDF viewer iframe,
      // so allow nas-stream: explicitly (QuickLook PDF preview).
      "frame-src 'self' nas-stream:; " +
      "object-src 'self' nas-stream:; " +
      "worker-src 'self' blob:; " +
      `connect-src 'self' nas-stream: ${DASHBOARD_ICONS_METADATA_URL}`
    : "default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: nas-stream:; " +
      `img-src 'self' data: blob: nas-stream: ${DASHBOARD_ICONS_CDN_PREFIX}; ` +
      "media-src 'self' blob: nas-stream:; " +
      "frame-src 'self' nas-stream:; " +
      "object-src 'self' nas-stream:; " +
      "worker-src 'self' blob:; " +
      `connect-src 'self' nas-stream: ws: wss: ${DASHBOARD_ICONS_METADATA_URL}`

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    // Remove any existing CSP header regardless of case before injecting ours
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key]
    }
    headers['Content-Security-Policy'] = [csp]
    callback({ responseHeaders: headers })
  })

  // Register the nas-stream:// protocol before creating the window so the
  // renderer can use it as soon as it loads.
  registerNasStreamProtocol()

  createWindow()

  // Tray is optional — a missing icon asset must not crash the app
  try {
    createTray()
  } catch (err) {
    console.error('[main] Tray creation failed:', err.message)
  }

  registerIPC()
  registerUpdateIPC()
  await initAutoUpdater()

  // After the system wakes from sleep the GPU compositor can go stale,
  // leaving the window black. invalidate() forces a repaint without a full reload.
  powerMonitor.on('resume', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.invalidate()
    }
  })

  // Auto-start watchers for all configured connections that have a local folder
  try {
    const { getConfig } = await import('./config.js')
    const cfg = getConfig()
    const w = await getWatcher()
    for (const conn of (cfg.connections ?? [])) {
      if (!conn.localFolder) continue
      try {
        if (!existsSync(conn.localFolder) || !statSync(conn.localFolder).isDirectory()) continue
      } catch { continue }
      w.startWatcher(
        conn.id,
        conn.localFolder,
        makeFileDetectedCallback(conn.id),
        () => sendToRenderer('watcher:status', w.listWatcherStates()),
      )
    }
    if ((cfg.connections ?? []).some((c) => c.localFolder)) {
      sendToRenderer('watcher:status', w.listWatcherStates())
    }

    // Kick the worker in case there are PENDING jobs left from a previous session.
    // onFileDetected only calls ensureWorkerRunning for newly detected files, so
    // jobs that were already PENDING when the app restarted would otherwise sit idle.
    const q = await getQueue()
    if (q.listJobs().some((j) => j.status === 'PENDING')) {
      const { ensureWorkerRunning } = await import('./worker.js')
      ensureWorkerRunning()
    }
  } catch { /* config not set — watchers will not auto-start */ }
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', () => {
  for (const entry of _sftpPool.values()) {
    clearTimeout(entry.timer)
    try { entry.client.end() } catch { /* best effort */ }
  }
  _sftpPool.clear()
})

app.on('window-all-closed', () => {
  // Stay alive in the tray
})
