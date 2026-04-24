// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

describe('size-scan active guard', () => {
  it('sends when this scan is still current', () => {
    const send = vi.fn()
    const scans = new Map()
    const state = { cancelled: false }
    scans.set('conn1', state)
    const isActive = () => scans.get('conn1') === state
    if (isActive()) send('size:level', {})
    expect(send).toHaveBeenCalled()
  })

  it('does not send when a newer scan replaced this one', () => {
    const send = vi.fn()
    const scans = new Map()
    const state = { cancelled: false }
    const newer = { cancelled: false }
    scans.set('conn1', newer)  // newer scan replaced state
    const isActive = () => scans.get('conn1') === state
    if (isActive()) send('size:level', {})
    expect(send).not.toHaveBeenCalled()
  })
})
