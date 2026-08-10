// @vitest-environment node
// A skipped transfer must NEVER delete the local source.
// The queue is a backup pipeline — deleting the original because a same-named
// file merely exists on the remote is silent data loss.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { unlinkMock, transferMock, readdirMock, rmdirMock } = vi.hoisted(() => ({
  unlinkMock: vi.fn(() => Promise.resolve()),
  transferMock: vi.fn(),
  readdirMock: vi.fn(() => Promise.resolve([])),
  rmdirMock: vi.fn(() => Promise.resolve()),
}))

vi.mock('./queue.js', () => ({
  getNextPending: vi.fn(),
  updateJob: vi.fn(),
  listJobs: vi.fn(() => []),
  STATUS: { PENDING: 'PENDING', TRANSFERRING: 'TRANSFERRING', DONE: 'DONE', ERROR: 'ERROR' },
}))
vi.mock('./config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./ipc-bridge.js', () => ({ init: vi.fn(), sendToRenderer: vi.fn(), notify: vi.fn() }))
vi.mock('./logger.js', () => ({ log: vi.fn() }))
vi.mock('./activity.js', () => ({ pushActivity: vi.fn() }))
vi.mock('./activity-format.js', () => ({
  describeActivity: vi.fn(() => ({ title: 't', detail: 'd', nav: null })),
  failureTitle: vi.fn(() => 'failed'),
}))
vi.mock('./folder-mode.js', () => ({
  shouldPruneEmptyDirs: vi.fn(() => false),
  deletesLocalAfterUpload: vi.fn((conn) => conn.operation === 'move' || conn.folderMode === 'mirror_clean'),
}))
vi.mock('fs/promises', () => ({ unlink: unlinkMock, readdir: readdirMock, rmdir: rmdirMock }))
vi.mock('./backends/sftp.js', () => ({
  createSftpBackend: vi.fn(() => ({ transfer: transferMock })),
}))

import { getNextPending, listJobs } from './queue.js'
import { getConfig } from './config.js'
import { notify } from './ipc-bridge.js'
import { pushActivity } from './activity.js'
import { shouldPruneEmptyDirs } from './folder-mode.js'
import { ensureWorkerRunning, stopWorker } from './worker.js'

const JOB = {
  id: 'job-1',
  srcPath: 'C:\\watch\\movie.mkv',
  filename: 'movie.mkv',
  relPath: 'movie.mkv',
  connectionId: 'conn-1',
  remoteDest: null,
}

// Run exactly one worker tick against a connection shaped by `connFields`,
// with the backend resolving `transferResult`. `jobStoreOverrides`, when
// given, is what listJobs() returns for this job once the transfer resolves
// — used to simulate the store having moved to a terminal status (e.g. a
// cancel) while the upload was in flight. `jobFields`, when given, overrides
// the fields of the job actually dequeued and transferred.
async function runOneJob(connFields, transferResult, jobStoreOverrides = null, jobFields = null) {
  getConfig.mockReturnValue({
    connections: [{
      id: 'conn-1',
      type: 'sftp',
      name: 'NAS',
      sftp: { remotePath: '/backups' },
      ...connFields,
    }],
  })
  const job = jobFields ? { ...JOB, ...jobFields } : { ...JOB }
  getNextPending.mockReturnValueOnce(job).mockReturnValue(null)
  transferMock.mockResolvedValue(transferResult)
  listJobs.mockReturnValue(jobStoreOverrides ? [{ ...JOB, ...jobStoreOverrides }] : [])

  ensureWorkerRunning()
  await vi.advanceTimersByTimeAsync(1000)
  expect(transferMock).toHaveBeenCalledTimes(1)
}

describe('worker delete safety', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does NOT delete the local source when a move transfer was skipped', async () => {
    // Failure scenario from the audit: local movie.mkv is intact, remote has a
    // same-named leftover — the transfer reports skipped, so the local file
    // must survive.
    await runOneJob({ operation: 'move' }, { skipped: true })
    expect(unlinkMock).not.toHaveBeenCalled()
  })

  it('deletes the local source exactly once after a REAL move transfer', async () => {
    await runOneJob({ operation: 'move' }, {})
    expect(unlinkMock).toHaveBeenCalledTimes(1)
    expect(unlinkMock).toHaveBeenCalledWith(JOB.srcPath)
  })

  it('deletes the local source after a real transfer under mirror_clean', async () => {
    await runOneJob({ operation: 'copy', folderMode: 'mirror_clean' }, {})
    expect(unlinkMock).toHaveBeenCalledTimes(1)
    expect(unlinkMock).toHaveBeenCalledWith(JOB.srcPath)
  })

  it('does NOT delete the local source when a mirror_clean transfer was skipped', async () => {
    await runOneJob({ operation: 'copy', folderMode: 'mirror_clean' }, { skipped: true })
    expect(unlinkMock).not.toHaveBeenCalled()
  })
})

describe('worker delete safety — cancelled while the transfer was in flight', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does NOT delete the local source when a move transfer was cancelled mid-flight', async () => {
    // The upload resolves normally, but the store already recorded the job
    // as cancelled (terminal ERROR) while it was in flight.
    await runOneJob({ operation: 'move' }, {}, { status: 'ERROR', errorMsg: 'Cancelled' })
    expect(unlinkMock).not.toHaveBeenCalled()
  })

  it('does NOT delete the local source when a mirror_clean transfer was cancelled mid-flight', async () => {
    await runOneJob({ operation: 'copy', folderMode: 'mirror_clean' }, {}, { status: 'ERROR', errorMsg: 'Cancelled' })
    expect(unlinkMock).not.toHaveBeenCalled()
  })

  it('does NOT prune empty ancestor directories when the transfer was cancelled mid-flight', async () => {
    shouldPruneEmptyDirs.mockReturnValueOnce(true)
    // A nested relative path so removeEmptyDirs has an ancestor dir between
    // the file and the watch root to actually consider pruning.
    await runOneJob(
      { operation: 'copy', folderMode: 'mirror_clean', localFolder: '/watch' },
      {},
      { status: 'ERROR', errorMsg: 'Cancelled' },
      { srcPath: '/watch/sub/movie.mkv', relPath: 'sub/movie.mkv' }
    )
    expect(readdirMock).not.toHaveBeenCalled()
    expect(rmdirMock).not.toHaveBeenCalled()
  })

  it('shows no completion notification and pushes no success activity entry when cancelled mid-flight', async () => {
    await runOneJob({ operation: 'move' }, {}, { status: 'ERROR', errorMsg: 'Cancelled' })
    expect(notify).not.toHaveBeenCalledWith('Transfer complete', expect.anything())
    expect(pushActivity).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'upload', level: 'info' })
    )
  })
})
