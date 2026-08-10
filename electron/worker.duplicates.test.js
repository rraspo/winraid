// @vitest-environment node
// Worker side of the duplicate-name feature:
//  - derives the backend transfer options from the connection (delete-local
//    protection, renameDuplicates, targetRelPath commit callback)
//  - a conflict result marks the job ERROR and never deletes the local source
//  - a renamed upload completes normally (local cleanup proceeds) and reports
//    the name the file actually landed under
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
vi.mock('fs/promises', () => ({ unlink: unlinkMock }))
vi.mock('./backends/sftp.js', () => ({
  createSftpBackend: vi.fn(() => ({ transfer: transferMock })),
}))

import { getNextPending, updateJob } from './queue.js'
import { getConfig } from './config.js'
import { notify } from './ipc-bridge.js'
import { pushActivity } from './activity.js'
import { ensureWorkerRunning, stopWorker } from './worker.js'

const JOB = {
  id: 'job-1',
  srcPath: 'C:\\watch\\movie.mkv',
  filename: 'movie.mkv',
  relPath: 'movie.mkv',
  connectionId: 'conn-1',
  remoteDest: null,
}

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
  if (typeof transferResult === 'function') transferMock.mockImplementation(transferResult)
  else transferMock.mockResolvedValue(transferResult)

  ensureWorkerRunning()
  await vi.advanceTimersByTimeAsync(1000)
  expect(transferMock).toHaveBeenCalledTimes(1)
}

describe('worker duplicate handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('passes delete-local protection and renameDuplicates from the connection to the backend', async () => {
    await runOneJob({ folderMode: 'mirror_clean', renameDuplicates: true }, {})

    const opts = transferMock.mock.calls[0][2]
    expect(opts.protectPreexisting).toBe(true)
    expect(opts.renameDuplicates).toBe(true)
    expect(typeof opts.onUploadStart).toBe('function')
  })

  it('does not protect pre-existing remote files for plain copy connections', async () => {
    await runOneJob({ operation: 'copy', folderMode: 'mirror' }, {})

    const opts = transferMock.mock.calls[0][2]
    expect(opts.protectPreexisting).toBe(false)
    expect(opts.renameDuplicates).toBe(false)
  })

  it('persists the backend-resolved target through onUploadStart', async () => {
    await runOneJob({ folderMode: 'mirror_clean', renameDuplicates: true }, async (job, onProgress, opts) => {
      await opts.onUploadStart('movie (1).mkv')
      return { renamedTo: 'movie (1).mkv' }
    })

    expect(updateJob).toHaveBeenCalledWith('job-1', { targetRelPath: 'movie (1).mkv' })
  })

  it('marks a conflict as ERROR, keeps the local file, and surfaces the failure', async () => {
    await runOneJob({ folderMode: 'mirror_clean' }, { conflict: true })

    expect(unlinkMock).not.toHaveBeenCalled()
    expect(updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'ERROR',
      errorMsg: expect.stringMatching(/already exists/i),
    }))
    expect(updateJob).not.toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'DONE' }))
    expect(notify).toHaveBeenCalledWith('Transfer failed', expect.stringContaining('movie.mkv'))
    expect(pushActivity).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', type: 'upload' }))
  })

  it('completes a renamed upload: job DONE, local source deleted, renamed name reported', async () => {
    await runOneJob({ folderMode: 'mirror_clean', renameDuplicates: true }, { renamedTo: 'movie (1).mkv' })

    expect(updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'DONE' }))
    expect(unlinkMock).toHaveBeenCalledWith(JOB.srcPath)
    expect(notify).toHaveBeenCalledWith('Transfer complete', expect.stringContaining('movie (1).mkv'))
  })
})
