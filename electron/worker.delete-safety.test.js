// @vitest-environment node
// WR-01 acceptance: a skipped transfer must NEVER delete the local source.
// The queue is a backup pipeline — deleting the original because a same-named
// file merely exists on the remote is silent data loss.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { unlinkMock, transferMock } = vi.hoisted(() => ({
  unlinkMock: vi.fn(() => Promise.resolve()),
  transferMock: vi.fn(),
}))

vi.mock('./queue.js', () => ({
  getNextPending: vi.fn(),
  updateJob: vi.fn(),
  listJobs: vi.fn(() => []),
  STATUS: { PENDING: 'PENDING', TRANSFERRING: 'TRANSFERRING', DONE: 'DONE', ERROR: 'ERROR' },
}))
vi.mock('./config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./main.js', () => ({ sendToRenderer: vi.fn(), notify: vi.fn() }))
vi.mock('./logger.js', () => ({ log: vi.fn() }))
vi.mock('./activity.js', () => ({ pushActivity: vi.fn() }))
vi.mock('./activity-format.js', () => ({
  describeActivity: vi.fn(() => ({ title: 't', detail: 'd', nav: null })),
  failureTitle: vi.fn(() => 'failed'),
}))
vi.mock('./folder-mode.js', () => ({ shouldPruneEmptyDirs: vi.fn(() => false) }))
vi.mock('fs/promises', () => ({ unlink: unlinkMock }))
vi.mock('./backends/sftp.js', () => ({
  createSftpBackend: vi.fn(() => ({ transfer: transferMock })),
}))

import { getNextPending } from './queue.js'
import { getConfig } from './config.js'
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
// with the backend resolving `transferResult`.
async function runOneJob(connFields, transferResult) {
  getConfig.mockReturnValue({
    connections: [{
      id: 'conn-1',
      type: 'sftp',
      name: 'NAS',
      sftp: { remotePath: '/backups' },
      ...connFields,
    }],
  })
  getNextPending.mockReturnValueOnce({ ...JOB }).mockReturnValue(null)
  transferMock.mockResolvedValue(transferResult)

  ensureWorkerRunning()
  await vi.advanceTimersByTimeAsync(1000)
  expect(transferMock).toHaveBeenCalledTimes(1)
}

describe('worker delete safety (WR-01)', () => {
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
