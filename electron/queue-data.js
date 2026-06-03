// Pure helpers for the queue persistence shape. Kept free of electron/fs
// imports so they can be unit-tested in isolation.
//
// queue.json was historically a bare array of jobs. It is now a wrapper
// object { jobs, lifetimeCompleted } where lifetimeCompleted is a monotonic
// count of transfers that have ever reached DONE — it survives clearDone and
// app restarts, unlike the DONE jobs in the list themselves.

const DONE = 'DONE'

function countDone(jobs) {
  return jobs.filter((j) => j?.status === DONE).length
}

export function normalizeQueueData(raw) {
  if (Array.isArray(raw)) {
    return { jobs: raw, lifetimeCompleted: countDone(raw) }
  }
  if (raw && typeof raw === 'object') {
    const jobs = Array.isArray(raw.jobs) ? raw.jobs : []
    const stored = Number.isFinite(raw.lifetimeCompleted) ? raw.lifetimeCompleted : 0
    // Never report fewer than the DONE jobs currently on disk.
    return { jobs, lifetimeCompleted: Math.max(stored, countDone(jobs)) }
  }
  return { jobs: [], lifetimeCompleted: 0 }
}
