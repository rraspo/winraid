import { describe, it, expect } from 'vitest'
import { normalizeQueueData, MAX_CLEARED_ENTRIES } from './queue-data.js'

const DONE = 'DONE'
const PENDING = 'PENDING'

describe('normalizeQueueData', () => {
  it('returns empty state for null/garbage', () => {
    expect(normalizeQueueData(null)).toEqual({ jobs: [], lifetimeCompleted: 0, cleared: [] })
    expect(normalizeQueueData(undefined)).toEqual({ jobs: [], lifetimeCompleted: 0, cleared: [] })
    expect(normalizeQueueData(42)).toEqual({ jobs: [], lifetimeCompleted: 0, cleared: [] })
  })

  it('migrates a legacy bare-array file, seeding the counter from existing DONE jobs', () => {
    const legacy = [
      { id: '1', status: DONE },
      { id: '2', status: PENDING },
      { id: '3', status: DONE },
    ]
    const out = normalizeQueueData(legacy)
    expect(out.jobs).toEqual(legacy)
    expect(out.lifetimeCompleted).toBe(2)
  })

  it('reads the new wrapped shape', () => {
    const wrapped = { jobs: [{ id: '1', status: PENDING }], lifetimeCompleted: 17 }
    const out = normalizeQueueData(wrapped)
    expect(out.jobs).toEqual(wrapped.jobs)
    expect(out.lifetimeCompleted).toBe(17)
  })

  it('seeds lifetimeCompleted from DONE jobs when the wrapper lacks the counter', () => {
    const out = normalizeQueueData({ jobs: [{ id: '1', status: DONE }] })
    expect(out.lifetimeCompleted).toBe(1)
  })

  it('never lets the counter go below the current DONE count', () => {
    // A stored counter lower than the visible DONE jobs would be inconsistent;
    // clamp up so the lifetime total is at least what is on disk.
    const out = normalizeQueueData({
      jobs: [{ id: '1', status: DONE }, { id: '2', status: DONE }],
      lifetimeCompleted: 1,
    })
    expect(out.lifetimeCompleted).toBe(2)
  })

  it('coerces a non-array jobs field to an empty array', () => {
    expect(normalizeQueueData({ jobs: 'nope', lifetimeCompleted: 5 }))
      .toEqual({ jobs: [], lifetimeCompleted: 5, cleared: [] })
  })
})

// -------------------------------------------------------------------------
// cleared tombstones — clearDone must remember what it cleared so a rescan
// does not treat the file as never-uploaded.
// -------------------------------------------------------------------------
describe('normalizeQueueData cleared tombstones', () => {
  it('returns an empty cleared list for the empty/garbage case', () => {
    expect(normalizeQueueData(null).cleared).toEqual([])
    expect(normalizeQueueData(undefined).cleared).toEqual([])
    expect(normalizeQueueData(42).cleared).toEqual([])
  })

  it('returns an empty cleared list for a legacy bare-array file', () => {
    const legacy = [
      { id: '1', status: DONE },
      { id: '2', status: PENDING },
    ]
    expect(normalizeQueueData(legacy).cleared).toEqual([])
  })

  it('parses the wrapped-object cleared list into { srcPath, connectionId, clearedAt } entries', () => {
    const wrapped = {
      jobs: [],
      lifetimeCompleted: 0,
      cleared: [
        { srcPath: '/media/a.mkv', connectionId: 'conn-1', clearedAt: 100 },
        { srcPath: '/media/b.mkv', connectionId: null, clearedAt: 200 },
      ],
    }
    expect(normalizeQueueData(wrapped).cleared).toEqual(wrapped.cleared)
  })

  it('drops malformed tombstone entries instead of throwing', () => {
    const wrapped = {
      jobs: [],
      cleared: [
        'not-an-object',
        { connectionId: 'conn-1', clearedAt: 100 }, // missing srcPath
        { srcPath: '', connectionId: 'conn-1', clearedAt: 100 }, // empty srcPath
        { srcPath: '/media/valid.mkv', connectionId: 'conn-1', clearedAt: 100 },
      ],
    }
    expect(() => normalizeQueueData(wrapped)).not.toThrow()
    expect(normalizeQueueData(wrapped).cleared).toEqual([
      { srcPath: '/media/valid.mkv', connectionId: 'conn-1', clearedAt: 100 },
    ])
  })

  it('treats a non-array cleared field (string or object) as an empty list rather than throwing', () => {
    expect(() => normalizeQueueData({ jobs: [], cleared: 'nope' })).not.toThrow()
    expect(normalizeQueueData({ jobs: [], cleared: 'nope' }).cleared).toEqual([])
    expect(normalizeQueueData({ jobs: [], cleared: { srcPath: '/media/a.mkv' } }).cleared).toEqual([])
  })

  it('caps the cleared list at MAX_CLEARED_ENTRIES, keeping the newest entries', () => {
    const overCap = Array.from({ length: MAX_CLEARED_ENTRIES + 5 }, (_, i) => ({
      srcPath: `/media/f${i}.mkv`,
      connectionId: null,
      clearedAt: i,
    }))
    const out = normalizeQueueData({ jobs: [], cleared: overCap })
    expect(out.cleared).toHaveLength(MAX_CLEARED_ENTRIES)
    // The oldest entries (lowest index) are dropped; the newest are kept.
    expect(out.cleared[0].srcPath).toBe('/media/f5.mkv')
    expect(out.cleared.at(-1).srcPath).toBe(`/media/f${MAX_CLEARED_ENTRIES + 4}.mkv`)
  })
})
