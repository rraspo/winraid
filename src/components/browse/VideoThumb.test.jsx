import { describe, it, expect } from 'vitest'
import { computeSeekTime } from './VideoThumb'

describe('computeSeekTime', () => {
  it('returns configured seconds offset', () => {
    expect(computeSeekTime(60, { mode: 'seconds', value: 3 })).toBe(3)
  })

  it('returns configured percent offset', () => {
    expect(computeSeekTime(100, { mode: 'percent', value: 10 })).toBe(10)
  })

  it('clamps seconds to 90% of duration for short videos', () => {
    expect(computeSeekTime(3, { mode: 'seconds', value: 5 })).toBeCloseTo(2.7, 1)
  })

  it('clamps percent to 90% of duration', () => {
    expect(computeSeekTime(10, { mode: 'percent', value: 95 })).toBe(9)
  })

  it('defaults to 2s when config is null', () => {
    expect(computeSeekTime(60, null)).toBe(2)
  })

  it('defaults to 2s when config is undefined', () => {
    expect(computeSeekTime(60, undefined)).toBe(2)
  })

  it('returns 0 when duration is 0 or NaN', () => {
    expect(computeSeekTime(0, { mode: 'seconds', value: 2 })).toBe(0)
    expect(computeSeekTime(NaN, { mode: 'seconds', value: 2 })).toBe(0)
  })

  it('handles fractional seconds', () => {
    expect(computeSeekTime(60, { mode: 'seconds', value: 1.5 })).toBe(1.5)
  })
})
