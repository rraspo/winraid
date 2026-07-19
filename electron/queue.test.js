// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// queue.js reads/writes queue.json from app.getPath('userData') and registers
// an app.on('before-quit') flush handler AT IMPORT TIME. vi.mock() factories are
// hoisted above imports, so any state they close over must come from
// vi.hoisted(). We expose:
//   - a mutable userData dir, pointed at a fresh temp dir per test
//   - a list that captures every before-quit handler queue.js registers
//   - a stable log spy (survives vi.resetModules so assertions stay attached)
const { getUserDataDir, setUserDataDir, beforeQuitHandlers, logMock } = vi.hoisted(() => {
  let dir = ''
  const handlers = []
  return {
    getUserDataDir: () => dir,
    setUserDataDir: (next) => { dir = next },
    beforeQuitHandlers: handlers,
    logMock: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => getUserDataDir(),
    on: (event, handler) => { if (event === 'before-quit') beforeQuitHandlers.push(handler) },
  },
}))

// The log IS the observable contract only for the recovery warning; everywhere
// else we mock it purely to stay quiet.
vi.mock('./logger.js', () => ({ log: logMock }))

let tmpUserData

beforeEach(() => {
  tmpUserData = mkdtempSync(join(tmpdir(), 'winraid-queue-test-'))
  setUserDataDir(tmpUserData)
  beforeQuitHandlers.length = 0
  logMock.mockClear()
  // Fixed clock so createdAt is deterministic and orderable via setSystemTime.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-18T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(tmpUserData, { recursive: true, force: true })
})

// Fresh module against the current temp dir. Calling it a second time in one
// test simulates an app restart: the file on disk is re-read from scratch.
async function loadQueue() {
  vi.resetModules()
  return import('./queue.js')
}

const queueFilePath = () => join(tmpUserData, 'queue.json')
const queueFileExists = () => existsSync(queueFilePath())
const readQueueFile = () => JSON.parse(readFileSync(queueFilePath(), 'utf8'))
const findJob = (list, id) => list.find((job) => job.id === id)

// -------------------------------------------------------------------------
// 1. enqueue defaults
// -------------------------------------------------------------------------
describe('enqueue', () => {
  it('derives filename from either slash style and applies documented defaults', async () => {
    const queue = await loadQueue()

    // Backslash (Windows) path with no opts: relPath falls back to filename,
    // operation defaults to copy, and the returned value is the job id.
    const windowsId = queue.enqueue('C:\\media\\a.mkv')
    const windowsJob = findJob(queue.listJobs(), windowsId)
    expect(windowsJob.id).toBe(windowsId)
    expect(windowsJob.filename).toBe('a.mkv')
    expect(windowsJob.relPath).toBe('a.mkv')
    expect(windowsJob.operation).toBe('copy')
    expect(windowsJob.status).toBe(queue.STATUS.PENDING)
    expect(windowsJob.progress).toBe(0)
    expect(windowsJob.retries).toBe(0)

    // Forward-slash (POSIX) path: filename is still the basename, and supplied
    // opts override the defaults.
    const posixId = queue.enqueue('/media/b.mkv', {
      relPath: 'shows/b.mkv',
      operation: 'move',
      size: 42,
      connectionId: 'conn-1',
    })
    const posixJob = findJob(queue.listJobs(), posixId)
    expect(posixJob.filename).toBe('b.mkv')
    expect(posixJob.relPath).toBe('shows/b.mkv')
    expect(posixJob.operation).toBe('move')
    expect(posixJob.size).toBe(42)
    expect(posixJob.connectionId).toBe('conn-1')
  })
})

// -------------------------------------------------------------------------
// 2. listJobs order
// -------------------------------------------------------------------------
describe('listJobs', () => {
  it('returns jobs newest-first', async () => {
    const queue = await loadQueue()

    const firstId = queue.enqueue('/media/first.mkv')
    vi.setSystemTime(new Date('2026-07-18T00:00:01Z'))
    const secondId = queue.enqueue('/media/second.mkv')
    vi.setSystemTime(new Date('2026-07-18T00:00:02Z'))
    const thirdId = queue.enqueue('/media/third.mkv')

    const orderedIds = queue.listJobs().map((job) => job.id)
    expect(orderedIds).toEqual([thirdId, secondId, firstId])
  })
})

// -------------------------------------------------------------------------
// 3. getNextPending — oldest-first, null when idle
// -------------------------------------------------------------------------
describe('getNextPending', () => {
  it('returns the oldest PENDING job, or null when none are pending', async () => {
    const queue = await loadQueue()

    const oldestId = queue.enqueue('/media/oldest.mkv')
    vi.setSystemTime(new Date('2026-07-18T00:00:01Z'))
    queue.enqueue('/media/newer.mkv')

    expect(queue.getNextPending().id).toBe(oldestId)

    // Drain the queue: with everything DONE/ERROR, nothing is pending.
    for (const job of queue.listJobs()) {
      queue.updateJob(job.id, { status: queue.STATUS.DONE })
    }
    expect(queue.getNextPending()).toBeNull()
  })
})

// -------------------------------------------------------------------------
// 4. hasActiveJob — the active-dedupe contract
// -------------------------------------------------------------------------
describe('hasActiveJob', () => {
  it('matches only in-flight jobs for the same path, honouring connectionId', async () => {
    const queue = await loadQueue()
    const srcPath = '/media/movie.mkv'
    const jobId = queue.enqueue(srcPath, { connectionId: 'conn-1' })

    // PENDING with matching connectionId is active.
    expect(queue.hasActiveJob(srcPath, 'conn-1')).toBe(true)
    // A null connectionId matches a job with any connectionId (legacy fallback).
    expect(queue.hasActiveJob(srcPath, null)).toBe(true)
    // A different connectionId does not match.
    expect(queue.hasActiveJob(srcPath, 'conn-2')).toBe(false)
    // A different path never matches.
    expect(queue.hasActiveJob('/media/other.mkv', 'conn-1')).toBe(false)

    // TRANSFERRING still counts as active.
    queue.updateJob(jobId, { status: queue.STATUS.TRANSFERRING })
    expect(queue.hasActiveJob(srcPath, 'conn-1')).toBe(true)

    // Once DONE, the job is no longer active.
    queue.updateJob(jobId, { status: queue.STATUS.DONE })
    expect(queue.hasActiveJob(srcPath, 'conn-1')).toBe(false)
    expect(queue.hasActiveJob(srcPath, null)).toBe(false)
  })

  it('does not treat an ERROR job as active', async () => {
    const queue = await loadQueue()
    const srcPath = '/media/failed.mkv'
    const jobId = queue.enqueue(srcPath, { connectionId: 'conn-1' })
    queue.updateJob(jobId, { status: queue.STATUS.ERROR })

    expect(queue.hasActiveJob(srcPath, 'conn-1')).toBe(false)
    expect(queue.hasActiveJob(srcPath, null)).toBe(false)
  })
})

// -------------------------------------------------------------------------
// 5. shouldSkipOnRescan — the rescan-dedupe contract
// -------------------------------------------------------------------------
describe('shouldSkipOnRescan', () => {
  it('skips PENDING, TRANSFERRING and DONE, but re-detects ERROR', async () => {
    const queue = await loadQueue()

    const pendingId = queue.enqueue('/media/pending.mkv', { connectionId: 'conn-1' })
    const transferringId = queue.enqueue('/media/transferring.mkv', { connectionId: 'conn-1' })
    const doneId = queue.enqueue('/media/done.mkv', { connectionId: 'conn-1' })
    const errorId = queue.enqueue('/media/error.mkv', { connectionId: 'conn-1' })
    queue.updateJob(transferringId, { status: queue.STATUS.TRANSFERRING })
    queue.updateJob(doneId, { status: queue.STATUS.DONE })
    queue.updateJob(errorId, { status: queue.STATUS.ERROR })

    // Reference the ids so the linter sees them used, and to be explicit about
    // which fixture each assertion targets.
    expect(pendingId).toBeTruthy()

    expect(queue.shouldSkipOnRescan('/media/pending.mkv', 'conn-1')).toBe(true)
    expect(queue.shouldSkipOnRescan('/media/transferring.mkv', 'conn-1')).toBe(true)
    expect(queue.shouldSkipOnRescan('/media/done.mkv', 'conn-1')).toBe(true)
    // ERROR is ignored so a failed file gets re-detected on the next scan.
    expect(queue.shouldSkipOnRescan('/media/error.mkv', 'conn-1')).toBe(false)
  })

  it('honours connectionId: mismatch does not skip, null matches on path alone', async () => {
    const queue = await loadQueue()
    const srcPath = '/media/pending.mkv'
    queue.enqueue(srcPath, { connectionId: 'conn-1' })

    expect(queue.shouldSkipOnRescan(srcPath, 'conn-2')).toBe(false)
    expect(queue.shouldSkipOnRescan(srcPath, null)).toBe(true)
    expect(queue.shouldSkipOnRescan('/media/other.mkv', null)).toBe(false)
  })
})

// -------------------------------------------------------------------------
// 6. crash recovery
// -------------------------------------------------------------------------
describe('crash recovery', () => {
  it('re-queues interrupted TRANSFERRING jobs, preserves DONE, warns, and re-persists', async () => {
    // Hand-write a queue.json as a crashed process would leave it: one job
    // stuck mid-transfer, one still pending, one already completed.
    writeFileSync(queueFilePath(), JSON.stringify({
      jobs: [
        { id: 'job-transferring', srcPath: '/media/t.mkv', filename: 't.mkv', status: 'TRANSFERRING', createdAt: 100 },
        { id: 'job-pending',      srcPath: '/media/p.mkv', filename: 'p.mkv', status: 'PENDING',      createdAt: 200 },
        { id: 'job-done',         srcPath: '/media/d.mkv', filename: 'd.mkv', status: 'DONE',         createdAt: 300 },
      ],
      lifetimeCompleted: 5,
    }), 'utf8')

    const queue = await loadQueue()

    // The interrupted transfer is re-runnable: it is now PENDING and the oldest
    // pending job, so the worker will pick it up again. (This read also
    // triggers the lazy load that performs the recovery.)
    expect(queue.getNextPending().id).toBe('job-transferring')

    // Recovery itself must persist: getNextPending is read-only, so the only
    // write scheduled at this point is recovery's own. Asserting after the
    // drain below would be masked by the drain's persists.
    vi.advanceTimersByTime(200)
    const recoveredOnDisk = readQueueFile()
    expect(recoveredOnDisk.jobs.find((job) => job.id === 'job-transferring').status).toBe('PENDING')
    expect(recoveredOnDisk.jobs.some((job) => job.status === 'TRANSFERRING')).toBe(false)

    const byId = Object.fromEntries(queue.listJobs().map((job) => [job.id, job]))
    expect(byId['job-transferring'].status).toBe('PENDING')
    // The DONE job stays DONE and is never handed out for processing.
    expect(byId['job-done'].status).toBe('DONE')

    // Drain the pending jobs; the DONE job must never surface via getNextPending.
    const dequeuedIds = []
    let next = queue.getNextPending()
    while (next) {
      dequeuedIds.push(next.id)
      queue.updateJob(next.id, { status: queue.STATUS.DONE })
      next = queue.getNextPending()
    }
    expect(dequeuedIds).toEqual(['job-transferring', 'job-pending'])
    expect(dequeuedIds).not.toContain('job-done')

    // The recovery is announced through the warn log (the observable contract).
    expect(logMock).toHaveBeenCalledWith('warn', expect.stringContaining('Recovered 1 interrupted'))
  })
})

// -------------------------------------------------------------------------
// 7. corrupt / missing queue file
// -------------------------------------------------------------------------
describe('resilient load', () => {
  it('starts with an empty queue when no file exists', async () => {
    const queue = await loadQueue()
    expect(queue.listJobs()).toEqual([])
    expect(queue.getNextPending()).toBeNull()
  })

  it('starts with an empty queue on corrupt JSON without throwing', async () => {
    writeFileSync(queueFilePath(), '{oops', 'utf8')
    const queue = await loadQueue()
    expect(queue.listJobs()).toEqual([])
  })
})

// -------------------------------------------------------------------------
// 8. lifetime-completed counter
// -------------------------------------------------------------------------
describe('lifetime-completed counter', () => {
  it('increments once per DONE transition and is idempotent for repeat DONE', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv')

    expect(queue.getLifetimeCompleted()).toBe(0)
    queue.updateJob(jobId, { status: queue.STATUS.DONE })
    expect(queue.getLifetimeCompleted()).toBe(1)
    // Re-setting DONE on an already-DONE job must not double-count.
    queue.updateJob(jobId, { status: queue.STATUS.DONE, progress: 100 })
    expect(queue.getLifetimeCompleted()).toBe(1)
  })

  it('survives clearDone', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv')
    queue.updateJob(jobId, { status: queue.STATUS.DONE })

    queue.clearDone()
    expect(queue.listJobs()).toEqual([])
    expect(queue.getLifetimeCompleted()).toBe(1)
  })

  it('round-trips through a restart', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv')
    queue.updateJob(jobId, { status: queue.STATUS.DONE })
    queue.clearDone()
    vi.advanceTimersByTime(200)

    // Fresh module, same file on disk.
    const restarted = await loadQueue()
    expect(restarted.getLifetimeCompleted()).toBe(1)
  })

  it('reduceLifetimeCompleted floors fractions, clamps at zero, ignores non-finite input', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv')
    queue.updateJob(jobId, { status: queue.STATUS.DONE })
    const secondId = queue.enqueue('/media/b.mkv')
    queue.updateJob(secondId, { status: queue.STATUS.DONE })
    expect(queue.getLifetimeCompleted()).toBe(2)

    // Floors 1.9 down to a decrement of 1.
    expect(queue.reduceLifetimeCompleted(1.9)).toBe(1)
    // Non-finite input is treated as a zero decrement.
    expect(queue.reduceLifetimeCompleted(Infinity)).toBe(1)
    expect(queue.reduceLifetimeCompleted(NaN)).toBe(1)
    // Reducing by more than the counter clamps at zero.
    expect(queue.reduceLifetimeCompleted(10)).toBe(0)
  })
})

// -------------------------------------------------------------------------
// 9. retryJob
// -------------------------------------------------------------------------
describe('retryJob', () => {
  it('resets an ERROR job to PENDING and bumps the retry count', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv')
    queue.updateJob(jobId, {
      status: queue.STATUS.ERROR,
      progress: 60,
      errorMsg: 'boom',
      errorAt: 1234,
    })

    queue.retryJob(jobId)

    const job = findJob(queue.listJobs(), jobId)
    expect(job.status).toBe(queue.STATUS.PENDING)
    expect(job.progress).toBe(0)
    expect(job.errorMsg).toBe('')
    expect(job.errorAt).toBeNull()
    expect(job.retries).toBe(1)
  })
})

// -------------------------------------------------------------------------
// 10. removeJob — ERROR jobs only
// -------------------------------------------------------------------------
describe('removeJob', () => {
  it('removes an ERROR job but leaves PENDING, TRANSFERRING and DONE untouched', async () => {
    const queue = await loadQueue()
    const pendingId = queue.enqueue('/media/pending.mkv')
    const transferringId = queue.enqueue('/media/transferring.mkv')
    const doneId = queue.enqueue('/media/done.mkv')
    const errorId = queue.enqueue('/media/error.mkv')
    queue.updateJob(transferringId, { status: queue.STATUS.TRANSFERRING })
    queue.updateJob(doneId, { status: queue.STATUS.DONE })
    queue.updateJob(errorId, { status: queue.STATUS.ERROR })

    // removeJob on non-ERROR jobs is a no-op.
    queue.removeJob(pendingId)
    queue.removeJob(transferringId)
    queue.removeJob(doneId)
    expect(queue.listJobs().map((job) => job.id).sort())
      .toEqual([pendingId, transferringId, doneId, errorId].sort())

    // removeJob on the ERROR job removes exactly that job.
    queue.removeJob(errorId)
    expect(findJob(queue.listJobs(), errorId)).toBeUndefined()
    expect(queue.listJobs()).toHaveLength(3)
  })
})

// -------------------------------------------------------------------------
// 11. clearDone
// -------------------------------------------------------------------------
describe('clearDone', () => {
  it('removes exactly the DONE jobs', async () => {
    const queue = await loadQueue()
    const pendingId = queue.enqueue('/media/pending.mkv')
    const doneOneId = queue.enqueue('/media/done1.mkv')
    const doneTwoId = queue.enqueue('/media/done2.mkv')
    const errorId = queue.enqueue('/media/error.mkv')
    queue.updateJob(doneOneId, { status: queue.STATUS.DONE })
    queue.updateJob(doneTwoId, { status: queue.STATUS.DONE })
    queue.updateJob(errorId, { status: queue.STATUS.ERROR })

    queue.clearDone()

    expect(queue.listJobs().map((job) => job.id).sort())
      .toEqual([pendingId, errorId].sort())
  })
})

// -------------------------------------------------------------------------
// 12. clearStale
// -------------------------------------------------------------------------
describe('clearStale', () => {
  it('removes PENDING and ERROR jobs whose file is gone, keeps TRANSFERRING and DONE', async () => {
    const queue = await loadQueue()
    const pendingGoneId = queue.enqueue('/media/pending-gone.mkv')
    const errorGoneId = queue.enqueue('/media/error-gone.mkv')
    const transferringGoneId = queue.enqueue('/media/transferring-gone.mkv')
    const doneGoneId = queue.enqueue('/media/done-gone.mkv')
    queue.updateJob(errorGoneId, { status: queue.STATUS.ERROR })
    queue.updateJob(transferringGoneId, { status: queue.STATUS.TRANSFERRING })
    queue.updateJob(doneGoneId, { status: queue.STATUS.DONE })

    // Every file "no longer exists".
    const removedIds = queue.clearStale(() => false)

    expect(removedIds.sort()).toEqual([pendingGoneId, errorGoneId].sort())
    // TRANSFERRING (actively sending) and DONE jobs are preserved.
    expect(queue.listJobs().map((job) => job.id).sort())
      .toEqual([transferringGoneId, doneGoneId].sort())
  })

  it('removes nothing and returns [] when all files still exist', async () => {
    const queue = await loadQueue()
    queue.enqueue('/media/a.mkv')
    queue.enqueue('/media/b.mkv')

    const removedIds = queue.clearStale(() => true)
    expect(removedIds).toEqual([])
    expect(queue.listJobs()).toHaveLength(2)
  })
})

// -------------------------------------------------------------------------
// 13. persist debounce / coalescing
// -------------------------------------------------------------------------
describe('persist debounce', () => {
  it('coalesces rapid mutations into a single delayed write of the final state', async () => {
    const queue = await loadQueue()

    // Several rapid mutations, all inside one debounce window.
    const firstId = queue.enqueue('/media/a.mkv')
    queue.enqueue('/media/b.mkv')
    const thirdId = queue.enqueue('/media/c.mkv')
    queue.updateJob(firstId, { status: queue.STATUS.DONE })

    // Nothing is written until the window closes.
    vi.advanceTimersByTime(199)
    expect(queueFileExists()).toBe(false)

    // The window closes: exactly one write lands the final state.
    vi.advanceTimersByTime(1)
    expect(queueFileExists()).toBe(true)
    const onDisk = readQueueFile()
    expect(onDisk.jobs).toHaveLength(3)
    expect(onDisk.lifetimeCompleted).toBe(1)
    expect(onDisk.jobs.find((job) => job.id === firstId).status).toBe('DONE')
    expect(onDisk.jobs.some((job) => job.id === thirdId)).toBe(true)

    // Prove the write was coalesced into a single timer: delete the file and
    // let more time pass — no second write recreates it.
    rmSync(queueFilePath())
    vi.advanceTimersByTime(1000)
    expect(queueFileExists()).toBe(false)
  })
})

// -------------------------------------------------------------------------
// 14. flush on before-quit
// -------------------------------------------------------------------------
describe('flush on quit', () => {
  it('writes the pending state immediately when the before-quit handler runs', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv')
    queue.updateJob(jobId, { status: queue.STATUS.DONE })

    // A write is scheduled but the debounce window has not elapsed yet.
    expect(queueFileExists()).toBe(false)

    // Invoke the before-quit handler queue.js registered at import time.
    const beforeQuit = beforeQuitHandlers.at(-1)
    expect(beforeQuit).toBeTypeOf('function')
    beforeQuit()

    // The final state is on disk without any timer having fired.
    expect(queueFileExists()).toBe(true)
    const onDisk = readQueueFile()
    expect(onDisk.lifetimeCompleted).toBe(1)
    expect(onDisk.jobs.find((job) => job.id === jobId).status).toBe('DONE')
  })
})

// -------------------------------------------------------------------------
// Additions (see summary for the regression each guards against)
// -------------------------------------------------------------------------
describe('updateJob edge cases', () => {
  // ADDITION: unknown id must be a silent no-op. A regression dropping the
  // `if (!job) return` guard would crash the worker on a stale/removed id.
  it('is a silent no-op for an unknown id and does not touch the counter', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv')

    expect(() => queue.updateJob('does-not-exist', { status: queue.STATUS.DONE })).not.toThrow()
    expect(queue.getLifetimeCompleted()).toBe(0)
    expect(findJob(queue.listJobs(), jobId).status).toBe(queue.STATUS.PENDING)
  })

  // ADDITION: partial update must not clobber unspecified fields, and must
  // ignore fields outside the write whitelist (srcPath is immutable). A
  // regression widening the field loop could corrupt job identity.
  it('writes only the passed whitelisted fields and leaves the rest intact', async () => {
    const queue = await loadQueue()
    const jobId = queue.enqueue('/media/a.mkv', { connectionId: 'conn-1' })
    queue.updateJob(jobId, { status: queue.STATUS.ERROR, errorMsg: 'boom' })

    // Updating only progress keeps status, errorMsg and srcPath as they were.
    queue.updateJob(jobId, { progress: 50, srcPath: '/hacked.mkv' })

    const job = findJob(queue.listJobs(), jobId)
    expect(job.progress).toBe(50)
    expect(job.status).toBe(queue.STATUS.ERROR)
    expect(job.errorMsg).toBe('boom')
    expect(job.connectionId).toBe('conn-1')
    // srcPath is not in the whitelist, so it cannot be overwritten.
    expect(job.srcPath).toBe('/media/a.mkv')
  })
})

describe('legacy file migration', () => {
  // ADDITION: the bare-array -> wrapper migration is covered for the pure
  // helper in queue-data.test.js, but never end-to-end through queue.js's load
  // path. A regression in the jobs() wiring would silently drop the seeded
  // lifetime counter on upgrade from an old install.
  it('loads a legacy bare-array queue.json and seeds the counter from DONE jobs', async () => {
    writeFileSync(queueFilePath(), JSON.stringify([
      { id: 'legacy-done',    srcPath: '/media/x.mkv', filename: 'x.mkv', status: 'DONE',    createdAt: 100 },
      { id: 'legacy-pending', srcPath: '/media/y.mkv', filename: 'y.mkv', status: 'PENDING', createdAt: 200 },
    ]), 'utf8')

    const queue = await loadQueue()

    expect(queue.listJobs().map((job) => job.id).sort()).toEqual(['legacy-done', 'legacy-pending'])
    expect(queue.getLifetimeCompleted()).toBe(1)
    expect(queue.getNextPending().id).toBe('legacy-pending')
  })
})
