import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs'
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
function persist() {
  const p   = queuePath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(_jobs, null, 2), 'utf8')
  renameSync(tmp, p)
}

// ---------------------------------------------------------------------------
// Public API — same interface as the previous better-sqlite3 version
// ---------------------------------------------------------------------------

/**
 * Add a new job to the queue.
 *
 * @param {string} srcPath   - Absolute local file path
 * @param {{ relPath?: string, operation?: string }} opts
 * @returns {string} The new job id
 */
export function enqueue(srcPath, opts = {}) {
  const id        = randomUUID()
  const filename  = srcPath.split(/[/\\]/).pop()
  const relPath   = opts.relPath   ?? filename
  const operation = opts.operation ?? 'copy'

  jobs().push({
    id,
    srcPath,
    filename,
    relPath,
    status:    STATUS.PENDING,
    progress:  0,
    errorMsg:  '',
    operation,
    retries:   0,
    createdAt: Date.now(),
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
 * @param {{ status?: string, progress?: number, errorMsg?: string, retries?: number }} fields
 */
export function updateJob(id, fields) {
  const job = jobs().find((j) => j.id === id)
  if (!job) return
  for (const key of ['status', 'progress', 'errorMsg', 'retries']) {
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
  job.retries += 1
  persist()
  log('info', `Retrying job ${id.slice(0, 8)} (attempt ${job.retries})`)
}

/** Remove all DONE jobs from the store. */
export function clearDone() {
  const before = _jobs.length
  _jobs = _jobs.filter((j) => j.status !== STATUS.DONE)
  persist()
  log('info', `Cleared ${before - _jobs.length} completed job(s).`)
}
