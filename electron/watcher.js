import chokidar from 'chokidar'
import { stat, readdir } from 'fs/promises'
import { basename, join } from 'path'
import { log } from './logger.js'

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------
const DEBOUNCE_MS        = 1500   // wait this long after the last fs event
const STABLE_POLLS       = 3      // size must be equal this many times in a row
const STABLE_INTERVAL_MS = 500    // pause between size polls

// ---------------------------------------------------------------------------
// Per-connection watcher instance
// ---------------------------------------------------------------------------
class WatcherInstance {
  constructor(connectionId) {
    this.connectionId   = connectionId
    this.watcher        = null
    this.folder         = null
    this.paused         = false
    this.onFileReady    = null
    this.statusCb       = null
    this.inFlight       = 0
    this.currentFile    = null   // filename currently undergoing stability polling
    this.debounceMap    = new Map()
  }

  start(folder, callback, onStatus) {
    this.stop()
    this.folder      = folder
    this.onFileReady = callback
    this.statusCb    = onStatus ?? null
    this.paused      = false

    // Always ignoreInitial — we run our own directory walk (_scanExisting)
    // which is reliable across chokidar versions on Windows.
    this.watcher = chokidar.watch(folder, {
      ignored: (filePath) => {
        const name = basename(filePath)
        return name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.part')
      },
      persistent: true,
      ignoreInitial: true,
    })

    this.watcher.on('add',       (filePath) => this._onFsEvent(filePath, false))
    this.watcher.on('change',    (filePath) => this._onFsEvent(filePath, false))
    this.watcher.on('unlink',    (filePath) => log('info', `File deleted [${this.connectionId}]: ${filePath}`))
    this.watcher.on('unlinkDir', (dirPath)  => log('info', `Directory deleted [${this.connectionId}]: ${dirPath}`))
    this.watcher.on('addDir',    (dirPath)  => log('info', `Directory created [${this.connectionId}]: ${dirPath}`))
    this.watcher.on('error',     (err)      => log('error', `Watcher [${this.connectionId}] error: ${err.message}`))

    log('info', `Watcher [${this.connectionId}] watching: ${folder}`)

    // Walk the folder to pick up files that appeared while the watcher was stopped.
    // shouldSkipOnRescan() in queue.js prevents re-queuing already-transferred files.
    this._scanExisting(folder).catch((err) => {
      log('error', `Watcher [${this.connectionId}] initial scan failed: ${err.message}`)
    })
  }

  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const t of this.debounceMap.values()) clearTimeout(t)
    this.debounceMap.clear()
    this.folder      = null
    this.onFileReady = null
    this.statusCb    = null
    this.inFlight    = 0
    this.currentFile = null
    this.paused      = false
  }

  pause() {
    this.paused = true
    log('info', `Watcher [${this.connectionId}] paused.`)
  }

  resume() {
    this.paused = false
    log('info', `Watcher [${this.connectionId}] resumed.`)
  }

  get isWatching() {
    return this.watcher !== null && !this.paused
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Recursively walk the watched folder and feed every file through the
   * normal _onFsEvent pipeline with isInitial=true. This replaces chokidar's
   * ignoreInitial:false behaviour which is unreliable on Windows with v4.
   */
  async _scanExisting(dir) {
    if (this.paused || !this.watcher) return

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      log('warn', `Watcher [${this.connectionId}] cannot read dir ${dir}: ${err.message}`)
      return
    }

    for (const entry of entries) {
      if (this.paused || !this.watcher) return

      const name = entry.name
      // Apply the same ignore rules as the chokidar watcher
      if (name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.part')) continue

      const fullPath = join(dir, name)
      if (entry.isDirectory()) {
        await this._scanExisting(fullPath)
      } else if (entry.isFile()) {
        this._onFsEvent(fullPath, true)
      }
    }

    this.statusCb?.(listWatcherStates())
  }

  _onFsEvent(filePath, isInitial = false) {
    if (this.paused) return

    if (this.debounceMap.has(filePath)) {
      clearTimeout(this.debounceMap.get(filePath))
    }

    const timer = setTimeout(() => {
      this.debounceMap.delete(filePath)
      this.inFlight++
      this.currentFile = basename(filePath)
      this.statusCb?.(listWatcherStates())
      this._waitForStable(filePath, isInitial).finally(() => {
        this.inFlight = Math.max(0, this.inFlight - 1)
        if (this.inFlight === 0) this.currentFile = null
        this.statusCb?.(listWatcherStates())
      })
    }, DEBOUNCE_MS)

    this.debounceMap.set(filePath, timer)
  }

  async _waitForStable(filePath, isInitial = false) {
    let lastSize   = -1
    let stableRuns = 0

    while (stableRuns < STABLE_POLLS) {
      await sleep(STABLE_INTERVAL_MS)

      if (this.paused) return

      let currentSize
      try {
        const info = await stat(filePath)
        currentSize = info.size
      } catch {
        log('warn', `File gone before transfer: ${filePath}`)
        return
      }

      if (currentSize === lastSize) {
        stableRuns++
      } else {
        lastSize   = currentSize
        stableRuns = 0
      }
    }

    if (!this.paused && this.onFileReady) {
      log('info', `File ready [${this.connectionId}]: ${filePath}`)
      Promise.resolve(this.onFileReady(filePath, { isInitial })).catch((err) => {
        log('error', `File detected callback failed [${this.connectionId}] ${filePath}: ${err.message}`)
      })
    }
  }
}

// ---------------------------------------------------------------------------
// WatcherManager — manages Map<connectionId, WatcherInstance>
// ---------------------------------------------------------------------------
const watchers = new Map()

/**
 * Returns a plain object keyed by connectionId describing every known watcher,
 * whether active or stopped. Active entries include folder, state, and file.
 * @returns {Record<string, { watching: boolean, folder: string|null, state: string|null, file: string|null }>}
 */
export function listWatcherStates() {
  const result = {}
  for (const [id, instance] of watchers) {
    const inFlight = instance.inFlight > 0
    result[id] = {
      watching: instance.watcher !== null && !instance.paused,
      folder:   instance.folder ?? null,
      state:    instance.watcher === null ? null : inFlight ? 'enqueueing' : 'watching',
      file:     inFlight ? (instance.currentFile ?? null) : null,
    }
  }
  return result
}

/**
 * Start watching a folder for a specific connection.
 * Creates a new WatcherInstance if one doesn't exist for this connectionId.
 */
export function startWatcher(connectionId, folder, callback, onStatus) {
  let instance = watchers.get(connectionId)
  if (!instance) {
    instance = new WatcherInstance(connectionId)
    watchers.set(connectionId, instance)
  }
  instance.start(folder, callback, onStatus)
}

/** Stop a specific connection's watcher and remove it from the map. */
export function stopWatcher(connectionId) {
  const instance = watchers.get(connectionId)
  if (instance) {
    instance.stop()
    watchers.delete(connectionId)
    log('info', `Watcher [${connectionId}] stopped.`)
  }
}

/** Stop all watchers (used on app quit or global pause). */
export function stopAllWatchers() {
  for (const [id, instance] of watchers) {
    instance.stop()
    log('info', `Watcher [${id}] stopped.`)
  }
  watchers.clear()
}

/** Pause a specific connection's watcher (keeps it registered but suspends events). */
export function pauseWatcher(connectionId) {
  watchers.get(connectionId)?.pause()
}

/** Resume a specific connection's watcher. */
export function resumeWatcher(connectionId) {
  watchers.get(connectionId)?.resume()
}

/** Check if a specific connection has an active (non-paused) watcher. */
export function isWatching(connectionId) {
  return watchers.get(connectionId)?.isWatching ?? false
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
