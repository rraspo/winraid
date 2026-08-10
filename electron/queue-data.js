// Pure helpers for the queue persistence shape. Kept free of electron/fs
// imports so they can be unit-tested in isolation.
//
// queue.json was historically a bare array of jobs. It is now a wrapper
// object { jobs, lifetimeCompleted, cleared } where:
//   - lifetimeCompleted is a monotonic count of transfers that have ever
//     reached DONE — it survives clearDone and app restarts, unlike the DONE
//     jobs in the list themselves.
//   - cleared is a bounded list of tombstones ({ srcPath, connectionId,
//     clearedAt }), one per DONE job clearDone has removed, so a later
//     rescan can still recognize the file as already handled even though the
//     job itself is gone from the list.

const DONE = 'DONE'

// Upper bound on the persisted tombstone list so queue.json cannot grow
// unbounded on a long-lived install. Order of magnitude, not a precise
// budget — trimming keeps the newest entries.
export const MAX_CLEARED_ENTRIES = 5000

function countDone(jobs) {
  return jobs.filter((j) => j?.status === DONE).length
}

function normalizeCleared(raw) {
  if (!Array.isArray(raw)) return []
  const clean = raw
    .filter((entry) => (
      entry
      && typeof entry === 'object'
      && typeof entry.srcPath === 'string'
      && entry.srcPath.length > 0
    ))
    .map((entry) => ({
      srcPath: entry.srcPath,
      connectionId: typeof entry.connectionId === 'string' ? entry.connectionId : null,
      clearedAt: Number.isFinite(entry.clearedAt) ? entry.clearedAt : 0,
    }))
  // Keep the newest entries — the list is maintained in append order, so the
  // newest entries are at the end.
  return clean.length > MAX_CLEARED_ENTRIES
    ? clean.slice(clean.length - MAX_CLEARED_ENTRIES)
    : clean
}

export function normalizeQueueData(raw) {
  if (Array.isArray(raw)) {
    return { jobs: raw, lifetimeCompleted: countDone(raw), cleared: [] }
  }
  if (raw && typeof raw === 'object') {
    const jobs = Array.isArray(raw.jobs) ? raw.jobs : []
    const stored = Number.isFinite(raw.lifetimeCompleted) ? raw.lifetimeCompleted : 0
    // Never report fewer than the DONE jobs currently on disk.
    return {
      jobs,
      lifetimeCompleted: Math.max(stored, countDone(jobs)),
      cleared: normalizeCleared(raw.cleared),
    }
  }
  return { jobs: [], lifetimeCompleted: 0, cleared: [] }
}
