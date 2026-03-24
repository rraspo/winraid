import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session,
  Tray,
  Menu,
  nativeImage,
  dialog,
  shell,
  Notification,
  powerMonitor,
} from 'electron'
import { join, basename, relative, dirname, resolve, sep, extname } from 'path'
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, utimesSync } from 'fs'
import { readdir as readdirAsync, stat as statAsync, mkdir as mkdirAsync, writeFile as writeFileAsync, readFile as readFileAsync, access as accessAsync, rm as rmAsync } from 'fs/promises'
import { createHash } from 'crypto'
import { homedir, userInfo } from 'os'
import { initLogger, getLogPath, clearLog, log } from './logger.js'

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

// Set of connectionIds that were watching before a pause-all operation,
// used by resume-all to restart only those connections.
let _watchingBeforePause = new Set()

let _watcher = null
let _queue   = null

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
    },
  })

  initLogger(sendToRenderer)

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

  // app.isPackaged is false during `electron-vite dev`, true in built .exe
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173/')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

// Recursively delete a remote directory tree via SFTP (no shell exec, no injection risk)
async function sftpRmRf(sftp, remotePath) {
  const list = await new Promise((resolve, reject) =>
    sftp.readdir(remotePath, (err, items) => err ? reject(err) : resolve(items ?? []))
  )
  for (const item of list) {
    const child = `${remotePath}/${item.filename}`
    if (((item.attrs.mode ?? 0) & 0o170000) === 0o040000) {
      await sftpRmRf(sftp, child)
    } else {
      await new Promise((resolve, reject) =>
        sftp.unlink(child, (err) => err ? reject(err) : resolve())
      )
    }
  }
  await new Promise((resolve, reject) =>
    sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve())
  )
}

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

// Recursively mirrors directory structure locally
async function remoteWalkCreate(sftp, remotePath, localPath, created = []) {
  mkdirSync(localPath, { recursive: true })
  created.push(localPath)
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return resolve() // skip unreadable dirs (permissions etc.)
      const dirs = list.filter(
        (e) => ((e.attrs.mode ?? 0) & 0o170000) === 0o040000 && !e.filename.startsWith('.')
      )
      Promise.all(
        dirs.map((d) =>
          remoteWalkCreate(sftp, `${remotePath}/${d.filename}`, join(localPath, d.filename), created)
        )
      ).then(resolve).catch(reject)
    })
  })
}

// ---------------------------------------------------------------------------
// Backup helpers — NAS → local recursive download
// ---------------------------------------------------------------------------

// Recursively collect all remote files under remotePath.
// Returns [{ remotePath, size, relPath }] where relPath is relative to the
// source root (includes the source dir basename as the first segment).
async function backupWalkRemote(sftp, remotePath, relBase) {
  const results = []
  const list = await new Promise((resolve, reject) =>
    sftp.readdir(remotePath, (err, items) => err ? reject(err) : resolve(items ?? []))
  )
  for (const item of list) {
    if (item.filename.startsWith('.')) continue
    const childRemote = `${remotePath}/${item.filename}`
    const childRel    = relBase ? `${relBase}/${item.filename}` : item.filename
    const isDir       = ((item.attrs.mode ?? 0) & 0o170000) === 0o040000
    if (isDir) {
      const sub = await backupWalkRemote(sftp, childRemote, childRel)
      results.push(...sub)
    } else {
      results.push({ remotePath: childRemote, size: item.attrs.size ?? 0, mtime: item.attrs.mtime ?? 0, relPath: childRel })
    }
  }
  return results
}

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
function backupDownloadFile(sftp, remotePath, localPath) {
  mkdirSync(dirname(localPath), { recursive: true })
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

  ipcMain.handle('config:get', async (_e, key) => {
    const { getConfig } = await import('./config.js')
    return key != null ? getConfig(key) : getConfig()
  })

  const CONFIG_SET_ALLOWLIST = [
    'localFolder', 'operation', 'folderMode', 'extensions',
    'backup', 'connections', 'activeConnectionId',
  ]

  ipcMain.handle('config:set', async (_e, key, value) => {
    const topKey = String(key).split('.')[0]
    if (!CONFIG_SET_ALLOWLIST.includes(topKey)) {
      return { error: 'forbidden key' }
    }
    const { setConfig } = await import('./config.js')
    setConfig(key, value)
  })

  ipcMain.handle('watcher:start', async (_e, connectionId) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false, error: 'invalid connectionId' }
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
      return { ok: false, error: 'invalid connectionId' }
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
      return { ok: false, error: 'invalid connectionId' }
    }
    const { getConfig } = await import('./config.js')
    const cfg  = getConfig()
    const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
    if (!conn) return { ok: false, error: 'connection not found' }
    const q = await getQueue()
    for (const rel of relPaths) {
      const filePath = join(localFolder, ...rel.split('/'))
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
      rmSync(folderPath, { recursive: true, force: true })
      mkdirSync(folderPath, { recursive: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
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
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      return new Promise((resolve) => {
        sftp.readdir(remotePath, (err, list) => {
          if (err) return resolve({ ok: false, error: err.message })
          const entries = list
            .map((e) => ({
              name:     e.filename,
              type:     ((e.attrs.mode ?? 0) & 0o170000) === 0o040000 ? 'dir' : 'file',
              size:     e.attrs.size ?? 0,
              modified: (e.attrs.mtime ?? 0) * 1000,
            }))
            .filter((e) => !e.name.startsWith('.'))
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
              return a.name.localeCompare(b.name)
            })
          resolve({ ok: true, entries })
        })
      })
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: check out folder structure locally --------------------
  ipcMain.handle('remote:checkout', async (_e, connectionId, remotePath, localRoot) => {
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
      return { ok: true, created }
    } catch (err) {
      log('error', `Remote checkout failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: read file content ------------------------------------
  ipcMain.handle('remote:read-file', async (_e, connectionId, remotePath) => {
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
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
      return { ok: true }
    } catch (err) {
      log('error', `Remote delete failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  // -- Remote browser: move / rename ----------------------------------------
  ipcMain.handle('remote:move', async (_e, connectionId, srcPath, dstPath) => {
    try {
      const sftp = await _poolGet(connectionId)
      if (!sftp) return { ok: false, error: 'Connection unavailable' }
      _poolTouch(connectionId)
      const result = await new Promise((resolve) => {
        sftp.rename(srcPath, dstPath, (err) => {
          if (err) return resolve({ ok: false, error: err.message })
          resolve({ ok: true })
        })
      })
      const label = await _connLabel(connectionId)
      if (result.ok) {
        log('info', `Remote move/rename [${label}] from: ${srcPath}`)
        log('info', `Remote move/rename [${label}]   to: ${dstPath}`)
      } else {
        log('error', `Remote move/rename failed [${label}] from: ${srcPath}`)
        log('error', `Remote move/rename failed [${label}]   to: ${dstPath} — ${result.error}`)
      }
      return result
    } catch (err) {
      const label = await _connLabel(connectionId)
      log('error', `Remote move/rename failed [${label}] from: ${srcPath}`)
      log('error', `Remote move/rename failed [${label}]   to: ${dstPath} — ${err.message}`)
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('remote:mkdir', async (_e, connectionId, remotePath) => {
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
      } else {
        log('error', `Remote mkdir failed [${await _connLabel(connectionId)}]: ${remotePath} — ${result.error}`)
      }
      return result
    } catch (err) {
      log('error', `Remote mkdir failed [${await _connLabel(connectionId)}]: ${remotePath} — ${err.message}`)
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
        if (!abs.startsWith(resolvedLF + sep) && abs !== resolvedLF) {
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

    // Reuse the active connection's SFTP settings
    const { getConfig } = await import('./config.js')
    const appCfg = getConfig()
    const activeConn = (appCfg.connections ?? []).find((c) => c.id === appCfg.activeConnectionId)
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
            const st = statSync(localPath)
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
          }
        }
      }
    } finally {
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
    return { ok: true }
  })

  // -- SSH: list remote directory (for the remote-path browser) ---------------
  ipcMain.handle('ssh:list-dir', async (_e, cfg) => {
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
        }
      }
    } else if (_checker) {
      // Initial scan is over — close the checker
      _checker.close()
      _checker = null
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
      const { openRemoteChecker } = await import('./backends/sftp.js')
      return await openRemoteChecker(conn.sftp)
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

function _sendUpdateStatus(status, info) {
  mainWindow?.webContents?.send('update:status', { status, ...info })
}

async function initAutoUpdater() {
  if (!app.isPackaged) return

  try {
    const { autoUpdater } = await import('electron-updater')
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
    log('error', `Auto-updater init failed: ${err.message}`)
  }
}

// IPC: manual update check + install
function registerUpdateIPC() {
  ipcMain.handle('update:check', async () => {
    if (!_autoUpdater) return { ok: false, error: 'Updater not available (dev mode)' }
    try {
      const result = await _autoUpdater.checkForUpdates()
      return { ok: true, version: result?.updateInfo?.version ?? null }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('update:install', () => {
    if (!_autoUpdater) return
    _autoUpdater.quitAndInstall(false, true)
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

function registerNasStreamProtocol() {
  // Privilege must be declared before app.whenReady() — done in the
  // protocol.registerSchemesAsPrivileged call below at module level.
  protocol.handle('nas-stream', async (request) => {
    try {
      const url = new URL(request.url)
      // hostname is the connectionId; pathname is the remote file path
      const connId     = url.hostname
      const remotePath = decodeURIComponent(url.pathname)

      if (!connId || !remotePath) {
        return new Response('Bad Request', { status: 400 })
      }

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

        // Cache miss — fetch full file from SFTP, resize, persist, serve
        const stream = sftp.createReadStream(remotePath)
        const chunks = []
        await new Promise((resolve, reject) => {
          stream.on('data',  (chunk) => chunks.push(chunk))
          stream.on('end',   resolve)
          stream.on('error', reject)
        })
        const buf = Buffer.concat(chunks)

        // Save full-res copy so QuickLook can serve it without re-fetching
        const fcp     = fullCachePath(connId, remotePath)
        const fullDir = join(app.getPath('userData'), 'thumbs', connId, 'full')
        await mkdirAsync(fullDir, { recursive: true })
        await writeFileAsync(fcp, buf).catch(() => {})

        const img = nativeImage.createFromBuffer(buf)
        if (img.isEmpty()) {
          // nativeImage could not decode the format — serve original bytes as-is
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type':  mime,
              'Cache-Control': CACHE,
            },
          })
        }

        const resized  = img.resize({ width: 240 })
        const jpegBuf  = resized.toJPEG(80)
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
      const fcp    = fullCachePath(connId, remotePath)
      const cached = await readFileAsync(fcp).catch(() => null)
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
        } catch (_) { /* cache write failure is non-fatal */ }
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
      log('error', `nas-stream: handler error — ${err.message}`)
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
  const csp = app.isPackaged
    ? "default-src 'self' nas-stream:; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: nas-stream: https://cdn.jsdelivr.net; " +
      "media-src 'self' nas-stream:; " +
      "connect-src 'self' https://cdn.jsdelivr.net https://raw.githubusercontent.com"
    : "default-src 'self' 'unsafe-inline' 'unsafe-eval' ws: nas-stream:; " +
      "img-src 'self' data: blob: nas-stream:; " +
      "media-src 'self' blob: nas-stream:; " +
      "connect-src 'self' ws: wss: https://cdn.jsdelivr.net https://raw.githubusercontent.com"

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
