// @vitest-environment node
// The delete-local path (move connections, mirror_clean's copy-then-clean)
// must route through deleteLocalFile so the local source stays recoverable
// — never a direct unlink, which leaves nothing to restore.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { unlinkMock, transferMock, deleteLocalFileMock, logMock } = vi.hoisted(() => ({
  unlinkMock: vi.fn(() => Promise.resolve()),
  transferMock: vi.fn(),
  deleteLocalFileMock: vi.fn(),
  logMock: vi.fn(),
}))

vi.mock('./queue.js', () => ({
  getNextPending: vi.fn(),
  updateJob: vi.fn(),
  listJobs: vi.fn(() => []),
  STATUS: { PENDING: 'PENDING', TRANSFERRING: 'TRANSFERRING', DONE: 'DONE', ERROR: 'ERROR' },
}))
vi.mock('./config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./ipc-bridge.js', () => ({ init: vi.fn(), sendToRenderer: vi.fn(), notify: vi.fn() }))
vi.mock('./logger.js', () => ({ log: logMock }))
vi.mock('./activity.js', () => ({ pushActivity: vi.fn() }))
vi.mock('./activity-format.js', () => ({
  describeActivity: vi.fn(() => ({ title: 't', detail: 'd', nav: null })),
  failureTitle: vi.fn(() => 'failed'),
}))
vi.mock('./folder-mode.js', () => ({
  shouldPruneEmptyDirs: vi.fn(() => false),
  deletesLocalAfterUpload: vi.fn((conn) => conn.operation === 'move' || conn.folderMode === 'mirror_clean'),
}))
vi.mock('fs/promises', () => ({ unlink: unlinkMock }))
vi.mock('./local-delete.js', () => ({ deleteLocalFile: deleteLocalFileMock }))
vi.mock('./backends/sftp.js', () => ({
  createSftpBackend: vi.fn(() => ({ transfer: transferMock })),
}))

import { getNextPending } from './queue.js'
import { getConfig } from './config.js'
import { ensureWorkerRunning, stopWorker } from './worker.js'

const JOB = {
  id: 'job-1',
  srcPath: 'C:\\sync\\movie.mkv',
  filename: 'movie.mkv',
  relPath: 'movie.mkv',
  connectionId: 'conn-1',
  remoteDest: null,
}

async function runMoveJob(deleteResult) {
  getConfig.mockReturnValue({
    connections: [{
      id: 'conn-1',
      type: 'sftp',
      name: 'NAS',
      operation: 'move',
      sftp: { remotePath: '/backups' },
    }],
  })
  getNextPending.mockReturnValueOnce({ ...JOB }).mockReturnValue(null)
  transferMock.mockResolvedValue({})
  deleteLocalFileMock.mockResolvedValue(deleteResult)

  ensureWorkerRunning()
  await vi.advanceTimersByTimeAsync(1000)
  expect(transferMock).toHaveBeenCalledTimes(1)
}

describe('worker delete-local routes through deleteLocalFile', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('calls deleteLocalFile and never unlink directly, and logs a recycle', async () => {
    await runMoveJob({ ok: true, recycled: true })

    expect(deleteLocalFileMock).toHaveBeenCalledWith(JOB.srcPath)
    expect(unlinkMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith('info', expect.stringContaining('Recycled'))
  })

  it('logs the outright delete with the bin refusal reason, and still never calls unlink directly', async () => {
    await runMoveJob({ ok: true, recycled: false, reason: 'not supported on this volume' })

    expect(deleteLocalFileMock).toHaveBeenCalledWith(JOB.srcPath)
    expect(unlinkMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith('warn', expect.stringContaining('not supported on this volume'))
    expect(logMock).not.toHaveBeenCalledWith('info', expect.stringContaining('Recycled'))
  })

  it('logs a failure when the delete could not happen at all', async () => {
    await runMoveJob({ ok: false, error: 'EPERM' })

    expect(deleteLocalFileMock).toHaveBeenCalledWith(JOB.srcPath)
    expect(unlinkMock).not.toHaveBeenCalled()
    expect(logMock).toHaveBeenCalledWith('warn', expect.stringContaining('EPERM'))
  })
})
