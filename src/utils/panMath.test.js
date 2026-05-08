import { describe, it, expect } from 'vitest'
import { computePan, PAN_GAIN } from './panMath'

const fitted = { viewportW: 1000, viewportH: 800, mediaW: 1000, mediaH: 800 }

describe('computePan', () => {
  it('returns no pan when zoom is 1 or below', () => {
    expect(computePan({ offsetX: 100, offsetY: 100, ...fitted, zoom: 1, invertPan: false })).toEqual({ x: 0, y: 0 })
    expect(computePan({ offsetX: 100, offsetY: 100, ...fitted, zoom: 0.5, invertPan: false })).toEqual({ x: 0, y: 0 })
  })

  it('inverts pan direction by default (mouse right pans image left)', () => {
    const { x } = computePan({ offsetX: 100, offsetY: 0, ...fitted, zoom: 2, invertPan: false, gain: 1 })
    expect(x).toBe(-100)
  })

  it('mirrors pan direction when invertPan is true', () => {
    const { x } = computePan({ offsetX: 100, offsetY: 0, ...fitted, zoom: 2, invertPan: true, gain: 1 })
    expect(x).toBe(100)
  })

  it('clamps pan so the image cannot go past its bounds', () => {
    const result = computePan({ offsetX: 10000, offsetY: 10000, ...fitted, zoom: 2, invertPan: false, gain: 1 })
    const maxX = (1000 * 2 - 1000) / 2  // 500
    const maxY = (800  * 2 -  800) / 2  // 400
    expect(result.x).toBe(-maxX)
    expect(result.y).toBe(-maxY)
  })

  it('returns zero pan when image fits the viewport (no overflow)', () => {
    const small = { viewportW: 1000, viewportH: 800, mediaW: 100, mediaH: 100 }
    const result = computePan({ offsetX: 200, offsetY: 100, ...small, zoom: 2, invertPan: false, gain: 1 })
    expect(result).toEqual({ x: 0, y: 0 })
  })

  it('reaches the image edge before the mouse reaches the viewport edge when gain > 1', () => {
    // At zoom=2 fitted, current code (gain=1) requires offsetX = viewportW/2 = 500 to reach max pan.
    // With PAN_GAIN=1.8, the same max pan should be reached at ~277px (500/1.8).
    const halfViewport = 500
    const partialOffset = halfViewport / PAN_GAIN
    const { x: clamped } = computePan({ offsetX: partialOffset, offsetY: 0, ...fitted, zoom: 2, invertPan: false })
    const maxX = (1000 * 2 - 1000) / 2  // 500
    expect(Math.abs(clamped)).toBeCloseTo(maxX, 5)
  })

  it('default gain is more aggressive than legacy linear mapping', () => {
    const halfwayOffset = 250  // half of half-viewport
    const legacy = computePan({ offsetX: halfwayOffset, offsetY: 0, ...fitted, zoom: 2, invertPan: false, gain: 1 })
    const modern = computePan({ offsetX: halfwayOffset, offsetY: 0, ...fitted, zoom: 2, invertPan: false })
    expect(Math.abs(modern.x)).toBeGreaterThan(Math.abs(legacy.x))
  })
})
