import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { log } from './logger.js'

// ---------------------------------------------------------------------------
// Status constants — single source of truth, imported by renderer via IPC
// ---------------------------------------------------------------------------
export const STATUS = {
  PENDING:      'PENDING',
  TRANSFERRING: 'TRANSFERRING',
  DONE:         'DONE',
  ERROR:        'ERROR',
}

// ---------------------------------------------------------------------------
// In-memory store — loaded once from queue.json on first access
// ---------------------------------------------------------------------------
let _jobs = null
let _path = null

function queuePath() {
  if (_path) return _path
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  _path = join(dir, 'queue.json')
  return _path
}

function jobs() {
  if (_jobs !== null) return _jobs
  const p = queuePath()
  try {
    _jobs = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    // File doesn't exist yet or is corrupt — start fresh
    _jobs = []
  }

  // Any job left in TRANSFERRING means the process died mid-transfer.
  // Reset them to PENDING so the worker picks them up again on this run.
  const stuck = _jobs.filter((j) => j.status === STATUS.TRANSFERRING)
  if (stuck.length > 0) {
    stuck.forEach((j) => { j.status = STATUS.PENDING })
    persist()
    log('warn', `Recovered ${stuck.length} interrupted transfer(s) — re-queued as PENDING`)
  }

  log('info', `Queue loaded: ${p}`)
  return _jobs
}

// Atomic write: write to .tmp then rename over the real file.
// On NTFS, rename over an existing file is atomic.
function _persistNow() {
  if (_jobs === null) return
  const p   = queuePath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(_jobs, null, 2), 'utf8')
  renameSync(tmp, p)
}

// Debounce rapid consecutive persist calls (e.g. progress ticks) so we do not
// hammer the filesystem on every update. The write is coalesced into a single
// call after PERSIST_DEBOUNCE_MS of inactivity.
const PERSIST_DEBOUNCE_MS = 200
let _persistTimer = null

function persist() {
  if (_persistTimer !== null) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    _persistNow()
  }, PERSIST_DEBOUNCE_MS)
}

// Flush any pending debounced persist immediately before the process exits
// so the final queue state is not lost on graceful shutdown.
app.on('before-quit', () => {
  if (_persistTimer !== null) {
    clearTimeout(_persistTimer)
    _persistTimer = null
    _persistNow()
  }
})

// ---------------------------------------------------------------------------
// Public API — same interface as the previous better-sqlite3 version
// ---------------------------------------------------------------------------

/**
 * Add a new job to the queue.
 *
 * @param {string} srcPath   - Absolute local file path
 * @param {{ relPath?: string, operation?: string, connectionId?: string, size?: number, remoteDest?: string }} opts
 * @returns {string} The new job id
 */
export function enqueue(srcPath, opts = {}) {
  const id           = randomUUID()
  const filename     = srcPath.split(/[/\\]/).pop()
  const relPath      = opts.relPath      ?? filename
  const operation    = opts.operation    ?? 'copy'
  const connectionId = opts.connectionId ?? null

  jobs().push({
    id,
    srcPath,
    filename,
    relPath,
    size:       opts.size      ?? null,
    status:     STATUS.PENDING,
    progress:   0,
    errorMsg:   '',
    errorAt:    null,
    operation,
    connectionId,
    remoteDest: opts.remoteDest ?? null,
    retries:    0,
    createdAt:  Date.now(),
  })
  persist()

  log('info', `Queued: ${filename} (${id.slice(0, 8)})`)
  return id
}

/**
 * Returns all jobs ordered newest-first for display in the queue view.
 * @returns {object[]}
 */
export function listJobs() {
  return [...jobs()].sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Returns the oldest PENDING job, or null if the queue is idle.
 * @returns {object|null}
 */
export function getNextPending() {
  return (
    jobs()
      .filter((j) => j.status === STATUS.PENDING)
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  )
}

/**
 * Partial update — only the fields you pass are written.
 *
 * @param {string} id
 * @param {{ status?: string, progress?: number, errorMsg?: string, errorAt?: number|null, retries?: number }} fields
 */
export function updateJob(id, fields) {
  const job = jobs().find((j) => j.id === id)
  if (!job) return
  for (const key of ['status', 'progress', 'errorMsg', 'errorAt', 'retries']) {
    if (fields[key] !== undefined) job[key] = fields[key]
  }
  persist()
}

/**
 * Reset an ERROR job back to PENDING so the worker picks it up again.
 * @param {string} id
 */
export function retryJob(id) {
  const job = jobs().find((j) => j.id === id)
  if (!job) return
  job.status   = STATUS.PENDING
  job.progress = 0
  job.errorMsg = ''
  job.errorAt  = null
  job.retries += 1
  persist()
  log('info', `Retrying job ${id.slice(0, 8)} (attempt ${job.retries})`)
}

/**
 * Returns true if an in-flight job (PENDING or TRANSFERRING) already exists
 * for this source path. Used to skip re-enqueuing files during the initial
 * watcher scan on startup. DONE and ERROR jobs are not considered active —
 * a file that was previously transferred may have changed while the watcher
 * was stopped and should be re-queued.
 *
 * When connectionId is provided, both srcPath and connectionId must match.
 * When connectionId is null, falls back to matching on srcPath only (for
 * legacy null-connectionId jobs).
 *
 * @param {string}      srcPath
 * @param {string|null} connectionId
 */
export function hasActiveJob(srcPath, connectionId = null) {
  return jobs().some((j) => {
    if (j.srcPath !== srcPath) return false
    if (j.status !== STATUS.PENDING && j.status !== STATUS.TRANSFERRING) return false
    if (connectionId !== null) return j.connectionId === connectionId
    return true
  })
}

/**
 * Returns true if a file should be skipped during an initial (rescan) pass.
 * Skips when any PENDING, TRANSFERRING, or DONE job exists for this path —
 * re-uploading the same file just overwrites, so there is no benefit.
 * ERROR jobs are ignored so the file can be re-detected and retried.
 *
 * @param {string}      srcPath
 * @param {string|null} connectionId
 */
export function shouldSkipOnRescan(srcPath, connectionId = null) {
  return jobs().some((j) => {
    if (j.srcPath !== srcPath) return false
    if (connectionId !== null && j.connectionId !== connectionId) return false
    return j.status === STATUS.PENDING || j.status === STATUS.TRANSFERRING || j.status === STATUS.DONE
  })
}

/** Remove a single ERROR job by id. */
export function removeJob(jobId) {
  const list = jobs()
  const job = list.find((j) => j.id === jobId)
  if (!job || job.status !== STATUS.ERROR) return
  _jobs = list.filter((j) => j.id !== jobId)
  persist()
  log('info', `Removed errored job ${jobId} (${job.filename}).`)
}

/** Remove all DONE jobs from the store. */
export function clearDone() {
  const list = jobs()
  const before = list.length
  _jobs = list.filter((j) => j.status !== STATUS.DONE)
  persist()
  log('info', `Cleared ${before - _jobs.length} completed job(s).`)
}

/**
 * Returns ids of all PENDING and ERROR jobs whose srcPath no longer exists
 * on the local filesystem, then removes them from the store.
 * TRANSFERRING jobs are skipped — the file is actively being sent.
 *
 * @param {(path: string) => boolean} existsFn  Injectable for testing (default: fs.existsSync)
 * @returns {string[]} Ids of the removed jobs
 */
export function clearStale(existsFn) {
  const exists = existsFn ?? existsSync
  const list   = jobs()
  const stale  = list.filter(
    (j) => (j.status === STATUS.PENDING || j.status === STATUS.ERROR) && !exists(j.srcPath)
  )
  if (stale.length === 0) return []
  const staleIds = stale.map((j) => j.id)
  _jobs = list.filter((j) => !staleIds.includes(j.id))
  persist()
  log('info', `Cleared ${stale.length} stale job(s) whose source files no longer exist.`)
  return staleIds
}
