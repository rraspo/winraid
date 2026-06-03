import { describe, it, expect } from 'vitest'
import { normalizeQueueData } from './queue-data.js'

const DONE = 'DONE'
const PENDING = 'PENDING'

describe('normalizeQueueData', () => {
  it('returns empty state for null/garbage', () => {
    expect(normalizeQueueData(null)).toEqual({ jobs: [], lifetimeCompleted: 0 })
    expect(normalizeQueueData(undefined)).toEqual({ jobs: [], lifetimeCompleted: 0 })
    expect(normalizeQueueData(42)).toEqual({ jobs: [], lifetimeCompleted: 0 })
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
      .toEqual({ jobs: [], lifetimeCompleted: 5 })
  })
})
