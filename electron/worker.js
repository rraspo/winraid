import { getNextPending, updateJob, STATUS } from './queue.js'
import { getConfig } from './config.js'
import { sendToRenderer, notify } from './main.js'
import { log } from './logger.js'
import { unlink } from 'fs/promises'

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------
let timer        = null   // setInterval handle
let isProcessing = false  // mutex — prevents overlapping transfers

const POLL_INTERVAL_MS = 800   // how often to check for new jobs when idle

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Idempotent — safe to call multiple times.
 * Starts the worker poll loop if it isn't already running.
 */
export function ensureWorkerRunning() {
  if (timer) return
  timer = setInterval(tick, POLL_INTERVAL_MS)
  log('info', 'Transfer worker started.')
}

/** Stop the worker poll loop (used on app quit / watcher stop). */
export function stopWorker() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  log('info', 'Transfer worker stopped.')
}

// ---------------------------------------------------------------------------
// Internal poll tick
// ---------------------------------------------------------------------------

async function tick() {
  // Skip if a transfer is already in flight
  if (isProcessing) return

  const job = getNextPending()
  if (!job) return

  isProcessing = true
  try {
    await processJob(job)
  } catch (err) {
    // Unexpected error in the worker itself (not a backend error)
    log('error', `Worker crash on job ${job.id.slice(0, 8)}: ${err.message}`)
    markError(job, `Unexpected worker error: ${err.message}`)
  } finally {
    isProcessing = false
  }
}

// ---------------------------------------------------------------------------
// Job processing
// ---------------------------------------------------------------------------

async function processJob(job) {
  log('info', `Transferring: ${job.filename}`)

  markTransferring(job)

  const cfg = getConfig()
  let backend

  try {
    backend = await buildBackend(cfg)
  } catch (err) {
    markError(job, `Backend init failed: ${err.message}`)
    return
  }

  try {
    await backend.transfer(job, makeProgressHandler(job))

    markDone(job)
    notify('Transfer complete', job.filename)
    log('info', `Done: ${job.filename}`)

    // Delete the local source file when:
    //  - operation is 'move' (explicit move-and-delete), OR
    //  - folderMode is 'mirror_clean' (copy-then-clean-local, regardless of operation)
    // NOTE: mirror_clean NEVER touches remote files — it only cleans the local side.
    const shouldDeleteLocal = cfg.operation === 'move' || cfg.folderMode === 'mirror_clean'
    if (shouldDeleteLocal) {
      await unlink(job.srcPath).catch((err) =>
        log('warn', `Could not delete local source after transfer: ${err.message}`)
      )
    }

    // mirror_clean: also prune empty ancestor directories on the local watch tree
    if (cfg.folderMode === 'mirror_clean') {
      await removeEmptyDirs(cfg.localFolder, job.srcPath)
    }
  } catch (err) {
    markError(job, err.message ?? String(err))
    notify('Transfer failed', `${job.filename}: ${err.message}`)
    log('error', `Failed: ${job.filename} — ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Progress handler factory
// ---------------------------------------------------------------------------

function makeProgressHandler(job) {
  return (bytesTransferred, totalBytes) => {
    const progress = totalBytes > 0 ? bytesTransferred / totalBytes : 0
    updateJob(job.id, { progress })

    const payload = {
      jobId: job.id,
      percent: Math.round(progress * 100),
      bytesTransferred,
      totalBytes,
    }
    sendToRenderer('transfer:progress', payload)
    // Also push a lightweight queue update so the table row refreshes
    sendToRenderer('queue:updated', {
      type: 'updated',
      job: { ...job, status: STATUS.TRANSFERRING, progress },
    })
  }
}

// ---------------------------------------------------------------------------
// Status helpers — update DB and push to renderer atomically
// ---------------------------------------------------------------------------

function markTransferring(job) {
  updateJob(job.id, { status: STATUS.TRANSFERRING, progress: 0 })
  sendToRenderer('queue:updated', {
    type: 'updated',
    job: { ...job, status: STATUS.TRANSFERRING, progress: 0 },
  })
}

function markDone(job) {
  updateJob(job.id, { status: STATUS.DONE, progress: 1 })
  sendToRenderer('queue:updated', {
    type: 'updated',
    job: { ...job, status: STATUS.DONE, progress: 1 },
  })
}

function markError(job, errorMsg) {
  updateJob(job.id, { status: STATUS.ERROR, errorMsg })
  sendToRenderer('queue:updated', {
    type: 'updated',
    job: { ...job, status: STATUS.ERROR, errorMsg },
  })
}

// ---------------------------------------------------------------------------
// Backend factory
// ---------------------------------------------------------------------------

async function buildBackend(cfg) {
  switch (cfg.connectionType) {
    case 'sftp': {
      const { createSftpBackend } = await import('./backends/sftp.js')
      return createSftpBackend(cfg.sftp)
    }
    case 'smb': {
      const { createSmbBackend } = await import('./backends/smb.js')
      return createSmbBackend(cfg.smb)
    }
    default:
      throw new Error(`Unknown connection type: "${cfg.connectionType}"`)
  }
}

// ---------------------------------------------------------------------------
// mirror_clean helper — remove empty ancestor dirs up to watchRoot
// ---------------------------------------------------------------------------

async function removeEmptyDirs(watchRoot, filePath) {
  const { readdir, rmdir } = await import('fs/promises')
  const { dirname, resolve } = await import('path')

  const root = resolve(watchRoot)
  let current = resolve(dirname(filePath))

  while (current !== root && current.startsWith(root)) {
    try {
      const entries = await readdir(current)
      if (entries.length > 0) break
      await rmdir(current)
      log('info', `Removed empty dir: ${current}`)
      current = dirname(current)
    } catch {
      break
    }
  }
}
