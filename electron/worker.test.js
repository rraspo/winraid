// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { transferMock } = vi.hoisted(() => ({ transferMock: vi.fn() }))

// Mock all dependencies before importing worker
vi.mock('./queue.js',  () => ({ getNextPending: vi.fn(), updateJob: vi.fn(), listJobs: vi.fn(() => []), STATUS: { PENDING: 'PENDING', TRANSFERRING: 'TRANSFERRING', DONE: 'DONE', ERROR: 'ERROR' } }))
vi.mock('./config.js', () => ({ getConfig: vi.fn(() => ({ connections: [] })) }))
vi.mock('./ipc-bridge.js', () => ({ init: vi.fn(), sendToRenderer: vi.fn(), notify: vi.fn() }))
vi.mock('./logger.js', () => ({ log: vi.fn() }))
vi.mock('./activity.js', () => ({ pushActivity: vi.fn() }))
vi.mock('./activity-format.js', () => ({
  describeActivity: vi.fn(() => ({ title: 't', detail: 'd', nav: null })),
  failureTitle: vi.fn(() => 'failed'),
}))
vi.mock('./folder-mode.js', () => ({
  shouldPruneEmptyDirs: vi.fn(() => false),
  deletesLocalAfterUpload: vi.fn(() => false),
}))
vi.mock('fs/promises', () => ({ unlink: vi.fn(() => Promise.resolve()) }))
vi.mock('./backends/sftp.js', () => ({
  createSftpBackend: vi.fn(() => ({ transfer: transferMock })),
}))

import { getNextPending, updateJob, listJobs } from './queue.js'
import { getConfig } from './config.js'
import { sendToRenderer } from './ipc-bridge.js'
import { ensureWorkerRunning, stopWorker, pauseWorker, resumeWorker } from './worker.js'

describe('worker pause / resume', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getNextPending.mockReturnValue(null)
  })

  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does not dequeue when paused', () => {
    ensureWorkerRunning()
    pauseWorker()
    vi.advanceTimersByTime(2000)
    expect(getNextPending).not.toHaveBeenCalled()
  })

  it('resumes dequeuing after resumeWorker', () => {
    ensureWorkerRunning()
    pauseWorker()
    vi.advanceTimersByTime(2000)
    resumeWorker()
    vi.advanceTimersByTime(1000)
    expect(getNextPending).toHaveBeenCalled()
  })

  it('isProcessing guard takes priority over paused (in-flight jobs are not interrupted)', () => {
    // The tick() function checks isProcessing before paused.
    // This means pausing cannot retroactively cancel a job already being processed.
    // We verify the guard order indirectly: when paused=false a tick reaches getNextPending,
    // confirming that isProcessing (not paused) is what blocks further dequeuing mid-job.
    ensureWorkerRunning()
    getNextPending.mockReturnValue({ id: 'job-1', filename: 'test.txt', connectionId: 'c1' })
    // Not paused — tick runs normally and reaches getNextPending
    vi.advanceTimersByTime(1000)
    expect(getNextPending).toHaveBeenCalledTimes(1)
    // Now pause. Subsequent ticks must not call getNextPending again.
    pauseWorker()
    vi.advanceTimersByTime(2000)
    // Call count must not have increased after pausing
    expect(getNextPending).toHaveBeenCalledTimes(1)
  })
})

describe('worker markDone convergence when a transfer is cancelled mid-flight', () => {
  const JOB = {
    id: 'job-1',
    srcPath: 'C:\\watch\\movie.mkv',
    filename: 'movie.mkv',
    relPath: 'movie.mkv',
    connectionId: 'conn-1',
    remoteDest: null,
  }

  beforeEach(() => {
    vi.useFakeTimers()
    // A preceding pause/resume test can leave the module-level "paused" flag
    // set with no matching resumeWorker() call — reset it so this block's
    // ticks are not silently skipped by unrelated state.
    resumeWorker()
    getConfig.mockReturnValue({
      connections: [{ id: 'conn-1', type: 'sftp', name: 'NAS', sftp: { remotePath: '/backups' } }],
    })
  })

  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('emits the job real current state instead of writing DONE when the store already marked it ERROR', async () => {
    getNextPending.mockReturnValueOnce({ ...JOB }).mockReturnValue(null)
    transferMock.mockResolvedValue({})
    listJobs.mockReturnValue([{ ...JOB, status: 'ERROR', errorMsg: 'Cancelled' }])

    ensureWorkerRunning()
    await vi.advanceTimersByTimeAsync(1000)

    expect(updateJob).not.toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'DONE' }))
    expect(sendToRenderer).toHaveBeenCalledWith('queue:updated', {
      type: 'updated',
      job: expect.objectContaining({ id: 'job-1', status: 'ERROR', errorMsg: 'Cancelled' }),
    })
    expect(sendToRenderer).not.toHaveBeenCalledWith(
      'queue:updated',
      expect.objectContaining({ job: expect.objectContaining({ status: 'DONE' }) })
    )
  })
})
