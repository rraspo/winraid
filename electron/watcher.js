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
// Module state
// ---------------------------------------------------------------------------
let watcher        = null
let paused         = false
let onFileReady    = null          // (filePath: string, meta: object) => void
let statusCb       = null          // (status: object) => void
let inFlight       = 0             // number of waitForStable coroutines running
let isInitialPhase = false         // true between watcher start and 'ready' event

// Map<filePath, timeoutId> — pending debounce timers per path
const debounceMap = new Map()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start watching `folder` recursively.
 * When a file is stable and ready to transfer, `callback(filePath, { isInitial })` is called.
 *
 * @param {string}   folder    - Absolute path to the local watch folder
 * @param {Function} callback  - (filePath, { isInitial: boolean }) => void
 * @param {Function} onStatus  - (status: object) => void
 * @param {{ queueExisting?: boolean }} options
 *   queueExisting: if true, emit 'add' for files already in the folder on startup
 *                  and mark them isInitial=true so callers can dedup against the queue.
 */
export function startWatcher(folder, callback, onStatus, options = {}) {
  stopWatcher()
  onFileReady    = callback
  statusCb       = onStatus ?? null
  paused         = false

  // When queueExisting is enabled we let chokidar scan existing files, then
  // clear the flag once 'ready' fires so subsequent live events are not initial.
  const ignoreInitial = !(options.queueExisting ?? false)
  isInitialPhase = !ignoreInitial

  // chokidar 4.x: `ignored` must be a function; `awaitWriteFinish` was removed.
  // We handle stability ourselves with size-polling in waitForStable().
  watcher = chokidar.watch(folder, {
    ignored: (filePath) => {
      const name = basename(filePath)
      // Skip hidden files and common incomplete-write suffixes
      return name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.part')
    },
    persistent: true,
    ignoreInitial,
  })

  watcher.on('add',    (filePath) => onFsEvent(filePath, isInitialPhase))
  watcher.on('change', (filePath) => onFsEvent(filePath, false))
  watcher.on('ready',  ()         => { isInitialPhase = false })
  watcher.on('error',  (err)      => log('error', `Watcher error: ${err.message}`))

  log('info', `Watching: ${folder}`)
}

/** Stop the watcher and cancel any pending debounce timers. */
export function stopWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  for (const t of debounceMap.values()) clearTimeout(t)
  debounceMap.clear()
  onFileReady    = null
  statusCb       = null
  inFlight       = 0
  paused         = false
  isInitialPhase = false
  log('info', 'Watcher stopped.')
}

/** Suspend processing of new fs events without closing the chokidar instance. */
export function pauseWatcher() {
  paused = true
  log('info', 'Watcher paused.')
}

/** Resume after a pause. Does not restart missed events. */
export function resumeWatcher() {
  paused = false
  log('info', 'Watcher resumed.')
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function onFsEvent(filePath, isInitial = false) {
  if (paused) return

  // Reset the debounce timer on every new event for this path.
  // For large files that emit rapid 'change' events, this keeps pushing
  // the check out until writes actually stop.
  if (debounceMap.has(filePath)) {
    clearTimeout(debounceMap.get(filePath))
  }

  const timer = setTimeout(() => {
    debounceMap.delete(filePath)
    inFlight++
    statusCb?.({ state: 'enqueueing', file: basename(filePath) })
    waitForStable(filePath, isInitial).finally(() => {
      inFlight = Math.max(0, inFlight - 1)
      if (inFlight === 0) statusCb?.({ state: 'watching' })
    })
  }, DEBOUNCE_MS)

  debounceMap.set(filePath, timer)
}

/**
 * Polls the file size until it has been stable for STABLE_POLLS consecutive
 * reads, then calls the registered onFileReady callback.
 */
async function waitForStable(filePath, isInitial = false) {
  let lastSize   = -1
  let stableRuns = 0

  while (stableRuns < STABLE_POLLS) {
    await sleep(STABLE_INTERVAL_MS)

    let currentSize
    try {
      const info = await stat(filePath)
      currentSize = info.size
    } catch {
      // File was deleted or moved before we could transfer it — ignore.
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

  if (!paused && onFileReady) {
    log('info', `File ready: ${filePath}`)
    onFileReady(filePath, { isInitial })
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
