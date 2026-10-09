import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatDate } from './format'

afterEach(() => { vi.restoreAllMocks() })

describe('formatDate', () => {
  it('formats a timestamp as a short month, day and year', () => {
    const ts = new Date(2026, 9, 8, 12).getTime()
    expect(formatDate(ts)).toBe(new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))
  })

  it('shows a dash for a missing timestamp', () => {
    expect(formatDate(0)).toBe('—')
    expect(formatDate(null)).toBe('—')
  })

  // Every visible Browse row formats its date on each render, so building a
  // locale formatter per call (what toLocaleDateString does) is the single
  // largest scripting cost of scrolling a long list.
  it('reuses one formatter instead of building one per call', () => {
    const format = vi.spyOn(Date.prototype, 'toLocaleDateString')
    for (let i = 1; i <= 100; i++) formatDate(1_700_000_000_000 + i * 86_400_000)
    expect(format).not.toHaveBeenCalled()
  })
})
