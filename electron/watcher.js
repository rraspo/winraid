import chokidar from 'chokidar'
import { stat } from 'fs/promises'
import { basename } from 'path'
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
    this.paused         = false
    this.onFileReady    = null
    this.statusCb       = null
    this.inFlight       = 0
    this.isInitialPhase = false
    this.debounceMap    = new Map()
  }

  start(folder, callback, onStatus, options = {}) {
    this.stop()
    this.onFileReady = callback
    this.statusCb    = onStatus ?? null
    this.paused      = false

    const ignoreInitial = !(options.queueExisting ?? false)
    this.isInitialPhase = !ignoreInitial

    this.watcher = chokidar.watch(folder, {
      ignored: (filePath) => {
        const name = basename(filePath)
        return name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.part')
      },
      persistent: true,
      ignoreInitial,
    })

    this.watcher.on('add',    (filePath) => this._onFsEvent(filePath, this.isInitialPhase))
    this.watcher.on('change', (filePath) => this._onFsEvent(filePath, false))
    this.watcher.on('ready',  ()         => { this.isInitialPhase = false })
    this.watcher.on('error',  (err)      => log('error', `Watcher [${this.connectionId}] error: ${err.message}`))

    log('info', `Watcher [${this.connectionId}] watching: ${folder}`)
  }

  stop() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const t of this.debounceMap.values()) clearTimeout(t)
    this.debounceMap.clear()
    this.onFileReady    = null
    this.statusCb       = null
    this.inFlight       = 0
    this.paused         = false
    this.isInitialPhase = false
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

  _onFsEvent(filePath, isInitial = false) {
    if (this.paused) return

    if (this.debounceMap.has(filePath)) {
      clearTimeout(this.debounceMap.get(filePath))
    }

    const timer = setTimeout(() => {
      this.debounceMap.delete(filePath)
      this.inFlight++
      this.statusCb?.({ state: 'enqueueing', file: basename(filePath) })
      this._waitForStable(filePath, isInitial).finally(() => {
        this.inFlight = Math.max(0, this.inFlight - 1)
        if (this.inFlight === 0) this.statusCb?.({ state: 'watching' })
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
      this.onFileReady(filePath, { isInitial })
    }
  }
}

// ---------------------------------------------------------------------------
// WatcherManager — manages Map<connectionId, WatcherInstance>
// ---------------------------------------------------------------------------
const watchers = new Map()

/**
 * Start watching a folder for a specific connection.
 * Creates a new WatcherInstance if one doesn't exist for this connectionId.
 */
export function startWatcher(connectionId, folder, callback, onStatus, options = {}) {
  let instance = watchers.get(connectionId)
  if (!instance) {
    instance = new WatcherInstance(connectionId)
    watchers.set(connectionId, instance)
  }
  instance.start(folder, callback, onStatus, options)
}

/** Stop a specific connection's watcher. */
export function stopWatcher(connectionId) {
  const instance = watchers.get(connectionId)
  if (instance) {
    instance.stop()
    watchers.delete(connectionId)
    log('info', `Watcher [${connectionId}] stopped.`)
  }
}

/** Stop all watchers (used on app quit). */
export function stopAll() {
  for (const [id, instance] of watchers) {
    instance.stop()
    log('info', `Watcher [${id}] stopped.`)
  }
  watchers.clear()
}

/** Pause a specific connection's watcher. */
export function pauseWatcher(connectionId) {
  watchers.get(connectionId)?.pause()
}

/** Resume a specific connection's watcher. */
export function resumeWatcher(connectionId) {
  watchers.get(connectionId)?.resume()
}

/** Pause all watchers. */
export function pauseAll() {
  for (const instance of watchers.values()) instance.pause()
}

/** Resume all watchers. */
export function resumeAll() {
  for (const instance of watchers.values()) instance.resume()
}

/** Get the status of all active watchers. Returns Map<connectionId, { watching, paused }>. */
export function getStatus() {
  const status = {}
  for (const [id, instance] of watchers) {
    status[id] = {
      watching: instance.watcher !== null,
      paused: instance.paused,
    }
  }
  return status
}

/** Check if a specific connection has an active watcher. */
export function isWatching(connectionId) {
  return watchers.get(connectionId)?.isWatching ?? false
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
