import { describe, it, expect } from 'vitest'
import { pageCssWidth } from './pdfFit'

const PORTRAIT  = { width: 612, height: 792 }   // US Letter in PDF points
const LANDSCAPE = { width: 792, height: 612 }

describe('pageCssWidth', () => {
  it('fills the available width in fit-width mode', () => {
    expect(pageCssWidth('width', { width: 1400, height: 800 }, PORTRAIT)).toBe(1400)
  })

  it('fits the whole page into the available height in fit-page mode', () => {
    // 800 tall at 612:792 → 618 wide
    expect(pageCssWidth('page', { width: 1400, height: 800 }, PORTRAIT)).toBe(618)
  })

  it('is limited by width in fit-page mode when the box is narrower than the page', () => {
    expect(pageCssWidth('page', { width: 400, height: 800 }, LANDSCAPE)).toBe(400)
  })

  it('returns 0 for an unmeasured box or an unknown page size', () => {
    expect(pageCssWidth('width', { width: 0, height: 0 }, PORTRAIT)).toBe(0)
    expect(pageCssWidth('page', { width: 600, height: 400 }, null)).toBe(0)
  })
})
