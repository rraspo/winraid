import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  dialog,
  shell,
  Notification,
  powerMonitor,
} from 'electron'
import { join, basename, relative, dirname, resolve, sep } from 'path'
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, utimesSync } from 'fs'
import { homedir, userInfo } from 'os'
import { initLogger, getLogPath, log } from './logger.js'

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
let _backupAbort = false   // cancellation flag for backup:run

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
// SSH config parser — used by the ssh:scan-configs IPC handler
// ---------------------------------------------------------------------------
function parseSshConfig(content, homeDir) {
  const entries = []
  let current = null

  for (let line of content.split('\n')) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue

    const spaceIdx = line.search(/\s/)
    if (spaceIdx === -1) continue
    const key = line.slice(0, spaceIdx).toLowerCase()
    const val = line.slice(spaceIdx).trim()

    if (key === 'host') {
      if (current) entries.push(current)
      // Skip wildcard-only patterns (*, ?)
      current = (!val.includes('*') && !val.includes('?'))
        ? { hostPattern: val, host: val, port: 22, username: '', keyPath: '' }
        : null
    } else if (current) {
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
  if (current) entries.push(current)

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
      sandbox: false,
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

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show WinRaid',
      click: () => { mainWindow.show(); mainWindow.focus() },
    },
    {
      label: isPaused ? 'Resume watcher' : 'Pause watcher',
      click: async () => {
        isPaused = !isPaused
        const w = await getWatcher()
        isPaused ? w.pauseWatcher() : w.resumeWatcher()
        sendToRenderer('watcher:status', { watching: !isPaused })
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

// Recursively walk a local directory and collect file paths
function walkLocal(dir, results = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walkLocal(full, results)
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
function calcDirSize(dirPath) {
  let total = 0
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += calcDirSize(full)
      } else {
        try { total += statSync(full).size } catch { /* skip inaccessible */ }
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

  ipcMain.handle('config:set', async (_e, key, value) => {
    const { setConfig } = await import('./config.js')
    setConfig(key, value)
  })

  ipcMain.handle('watcher:start', async (_e, folder) => {
    const { getConfig } = await import('./config.js')
    const watcherOpts = { queueExisting: getConfig('watcher.queueExisting') ?? true }
    const w = await getWatcher()
    w.startWatcher(folder, onFileDetected, (s) => sendToRenderer('watcher:status', { watching: true, folder, ...s }), watcherOpts)
    sendToRenderer('watcher:status', { watching: true, folder, state: 'watching' })
    isPaused = false
    rebuildTrayMenu()
  })

  ipcMain.handle('watcher:stop', async () => {
    const w = await getWatcher()
    w.stopWatcher()
    sendToRenderer('watcher:status', { watching: false, folder: null })
    isPaused = false
    rebuildTrayMenu()
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

  ipcMain.handle('queue:clear-done', async () => {
    const q = await getQueue()
    q.clearDone()
    sendToRenderer('queue:updated', { type: 'cleared' })
  })

  ipcMain.handle('queue:enqueue-batch', async (_e, localFolder, relPaths) => {
    const { getConfig } = await import('./config.js')
    const cfg = getConfig()
    const q = await getQueue()
    for (const rel of relPaths) {
      const filePath = join(localFolder, ...rel.split('/'))
      const relPath = cfg.folderMode === 'flat' ? basename(filePath) : rel
      const jobId = q.enqueue(filePath, { relPath, operation: cfg.operation })
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

  // -- SSH: test connection ---------------------------------------------------
  ipcMain.handle('ssh:test', async (_e, cfg) => {
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
  ipcMain.handle('remote:list', async (_e, cfg, remotePath) => {
    try {
      const { Client } = await import('ssh2')
      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try { privateKey = readFileSync(kp) }
        catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
      }
      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp((err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }
              sftp.readdir(remotePath, (err, list) => {
                conn.end()
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

  // -- Remote browser: check out folder structure locally --------------------
  ipcMain.handle('remote:checkout', async (_e, cfg, remotePath, localRoot) => {
    try {
      const { Client } = await import('ssh2')
      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try { privateKey = readFileSync(kp) }
        catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
      }
      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp(async (err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }
              const created = []
              // Strip the configured remote base (cfg.remotePath) so only the
              // relative portion is appended to localRoot.
              // e.g. cfg.remotePath=/mnt/user, remotePath=/mnt/user/media/movies,
              //      localRoot=Z:\unraid  →  localTarget=Z:\unraid\media\movies
              const remoteBase = (cfg.remotePath || '').replace(/\/+$/, '')
              const rel = remotePath.startsWith(remoteBase)
                ? remotePath.slice(remoteBase.length).replace(/^\/+/, '')
                : remotePath.replace(/^\/+/, '')
              const localTarget = rel
                ? join(localRoot, ...rel.split('/').filter(Boolean))
                : localRoot
              try {
                await remoteWalkCreate(sftp, remotePath, localTarget, created)
                conn.end()
                resolve({ ok: true, created })
              } catch (e) {
                conn.end()
                resolve({ ok: false, error: e.message })
              }
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

  // -- Remote browser: read file content ------------------------------------
  ipcMain.handle('remote:read-file', async (_e, cfg, remotePath) => {
    try {
      const { Client } = await import('ssh2')
      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try { privateKey = readFileSync(kp) }
        catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
      }
      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp((err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }
              sftp.readFile(remotePath, 'utf8', (err, content) => {
                conn.end()
                if (err) return resolve({ ok: false, error: err.message })
                resolve({ ok: true, content })
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

  // -- Remote browser: delete file or directory tree ------------------------
  ipcMain.handle('remote:delete', async (_e, cfg, remotePath, isDir) => {
    try {
      const { Client } = await import('ssh2')
      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try { privateKey = readFileSync(kp) }
        catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
      }
      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp(async (err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }
              try {
                if (isDir) {
                  await sftpRmRf(sftp, remotePath)
                } else {
                  await new Promise((res, rej) =>
                    sftp.unlink(remotePath, (e) => e ? rej(e) : res())
                  )
                }
                conn.end()
                resolve({ ok: true })
              } catch (e) {
                conn.end()
                resolve({ ok: false, error: e.message })
              }
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

  // -- Remote browser: move / rename ----------------------------------------
  ipcMain.handle('remote:move', async (_e, cfg, srcPath, dstPath) => {
    try {
      const { Client } = await import('ssh2')
      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try { privateKey = readFileSync(kp) }
        catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
      }
      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp((err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }
              sftp.rename(srcPath, dstPath, (err) => {
                conn.end()
                if (err) return resolve({ ok: false, error: err.message })
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

  // -- Remote: verify local files exist on NAS, then delete them locally -----
  ipcMain.handle('remote:verify-clean', async (_e, cfg, localFolder) => {
    try {
      let localFiles
      try {
        localFiles = walkLocal(localFolder)
      } catch (e) {
        return { ok: false, error: `Cannot read local folder: ${e.message}` }
      }

      const { Client } = await import('ssh2')
      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try { privateKey = readFileSync(kp) }
        catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
      }

      const remoteBase = (cfg.remotePath || '').replace(/\/+$/, '')

      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp(async (err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }

              let cleaned = 0
              const notFound = []
              const errors = []

              for (const localFile of localFiles) {
                const rel = relative(localFolder, localFile).replace(/\\/g, '/')
                const remotePath = remoteBase ? `${remoteBase}/${rel}` : `/${rel}`
                try {
                  await new Promise((res, rej) =>
                    sftp.stat(remotePath, (e) => e ? rej(e) : res())
                  )
                  // File confirmed on NAS — delete locally
                  try {
                    rmSync(localFile)
                    cleaned++
                  } catch (e) {
                    errors.push({ file: rel, error: e.message })
                  }
                } catch {
                  notFound.push(rel)
                }
              }

              conn.end()
              resolve({ ok: true, total: localFiles.length, cleaned, notFound, errors })
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

  // -- Remote browser: write file content -----------------------------------
  ipcMain.handle('remote:write-file', async (_e, cfg, remotePath, content) => {
    try {
      const { Client } = await import('ssh2')
      let privateKey
      if (cfg.keyPath) {
        const kp = cfg.keyPath.startsWith('~')
          ? join(homedir(), cfg.keyPath.slice(1).replace(/^[/\\]/, ''))
          : cfg.keyPath
        try { privateKey = readFileSync(kp) }
        catch (e) { return { ok: false, error: `Cannot read key file: ${e.message}` } }
      }
      return new Promise((resolve) => {
        const conn = new Client()
        conn
          .on('ready', () => {
            conn.sftp((err, sftp) => {
              if (err) { conn.end(); return resolve({ ok: false, error: err.message }) }
              sftp.writeFile(remotePath, content, (err) => {
                conn.end()
                if (err) return resolve({ ok: false, error: err.message })
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

  // -- Backup: NAS → local SFTP download -------------------------------------
  ipcMain.handle('backup:run', async (_e, cfg) => {
    _backupAbort = false
    const stats = { files: 0, skipped: 0, bytes: 0, totalBytes: 0, errors: [] }

    // Reuse the shared SFTP connection settings from the main config
    const { getConfig } = await import('./config.js')
    const sftpCfg = getConfig('sftp')

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
        if (_backupAbort) break

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
          if (_backupAbort) break

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

    stats.totalBytes = calcDirSize(cfg.localDest)
    sendToRenderer('backup:progress', { file: null, stats })

    if (_backupAbort) {
      log('warn', `Backup cancelled — ${stats.files} downloaded, ${stats.skipped} skipped, ${stats.errors.length} error(s)`)
    } else {
      log('info', `Backup complete — ${stats.files} downloaded, ${stats.skipped} skipped, ${stats.errors.length} error(s)`)
    }
    return { ok: true, stats }
  })

  ipcMain.handle('backup:cancel', () => {
    _backupAbort = true
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
// File-detected callback
// ---------------------------------------------------------------------------
async function onFileDetected(filePath, { isInitial = false } = {}) {
  const { getConfig } = await import('./config.js')
  const cfg = getConfig()

  const relPath = cfg.folderMode === 'flat'
    ? basename(filePath)
    : relative(cfg.localFolder, filePath).replace(/\\/g, '/')

  const q = await getQueue()

  // On the initial folder scan (watcher start with queueExisting enabled),
  // skip files that already have an active job — they are leftovers from a
  // previous session (PENDING, TRANSFERRING, or already DONE).
  if (isInitial && q.hasActiveJob(filePath)) return

  const jobId = q.enqueue(filePath, { relPath, operation: cfg.operation })
  sendToRenderer('queue:updated', { type: 'added', jobId })

  try {
    const { ensureWorkerRunning } = await import('./worker.js')
    ensureWorkerRunning()
  } catch { /* worker may already be running */ }
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
async function initAutoUpdater() {
  if (!app.isPackaged) return

  try {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.on('error', (err) => log('error', `Updater: ${err.message}`))
    autoUpdater.on('update-downloaded', () => {
      notify('WinRaid update ready', 'Restart to apply.')
      log('info', 'Update downloaded.')
    })
    autoUpdater.checkForUpdatesAndNotify()
  } catch (err) {
    log('error', `Auto-updater init failed: ${err.message}`)
  }
}


// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  createWindow()

  // Tray is optional — a missing icon asset must not crash the app
  try {
    createTray()
  } catch (err) {
    console.error('[main] Tray creation failed:', err.message)
  }

  registerIPC()
  await initAutoUpdater()

  // After the system wakes from sleep the GPU compositor can go stale,
  // leaving the window black. invalidate() forces a repaint without a full reload.
  powerMonitor.on('resume', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.invalidate()
    }
  })

  // Auto-start watcher if a folder was previously configured
  try {
    const { getConfig } = await import('./config.js')
    const cfg = getConfig()
    if (cfg.localFolder) {
      const watcherOpts = { queueExisting: cfg.watcher?.queueExisting ?? true }
      const w = await getWatcher()
      w.startWatcher(cfg.localFolder, onFileDetected, (s) => sendToRenderer('watcher:status', { watching: true, folder: cfg.localFolder, ...s }), watcherOpts)
      sendToRenderer('watcher:status', { watching: true, folder: cfg.localFolder, state: 'watching' })
    }
  } catch { /* config not set — watcher will not auto-start */ }
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  // Stay alive in the tray
})
