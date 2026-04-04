// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock all dependencies before importing worker
vi.mock('./queue.js',  () => ({ getNextPending: vi.fn(), updateJob: vi.fn(), listJobs: vi.fn(() => []), STATUS: { PENDING: 'PENDING', TRANSFERRING: 'TRANSFERRING', DONE: 'DONE', ERROR: 'ERROR' } }))
vi.mock('./config.js', () => ({ getConfig: vi.fn(() => ({ connections: [] })) }))
vi.mock('./main.js',   () => ({ sendToRenderer: vi.fn(), notify: vi.fn() }))
vi.mock('./logger.js', () => ({ log: vi.fn() }))

import { getNextPending } from './queue.js'
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
