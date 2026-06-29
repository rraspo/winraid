import { describe, it, expect } from 'vitest'
import { resolveTooltipPlacement } from './tooltipPlacement'

const viewport = { width: 1000, height: 800 }
const bubble = { width: 200, height: 40 }

// Anchor helper centered-ish; override edges as needed.
function anchor({ left, top, width = 60, height = 24 }) {
  return { left, top, right: left + width, bottom: top + height, width, height }
}

describe('resolveTooltipPlacement — horizontal axis (left/right)', () => {
  it('prefers right when there is room, even if side="left" was requested', () => {
    const a = anchor({ left: 100, top: 400 })
    const p = resolveTooltipPlacement({ side: 'left', anchor: a, bubble, viewport })
    expect(p.side).toBe('right')
    expect(p.style.left).toBe(a.right + 10) // gap
    expect(p.style.right).toBeUndefined()
  })

  it('flips to left only when the right side does not fit', () => {
    const a = anchor({ left: 900, top: 400 }) // right edge at 960, bubble 200 won't fit in 1000
    const p = resolveTooltipPlacement({ side: 'right', anchor: a, bubble, viewport })
    expect(p.side).toBe('left')
    expect(p.style.right).toBe(viewport.width - a.left + 10)
    expect(p.style.left).toBeUndefined()
  })

  it('keeps right (preferred) when neither side fits', () => {
    const wide = { width: 980, height: 40 }
    const a = anchor({ left: 480, top: 400 })
    const p = resolveTooltipPlacement({ side: 'left', anchor: a, bubble: wide, viewport })
    expect(p.side).toBe('right')
  })
})

describe('resolveTooltipPlacement — vertical axis (top/bottom)', () => {
  it('prefers bottom when there is room, even if side="top" was requested', () => {
    const a = anchor({ left: 400, top: 100 })
    const p = resolveTooltipPlacement({ side: 'top', anchor: a, bubble, viewport })
    expect(p.side).toBe('bottom')
    expect(p.style.top).toBe(a.bottom + 10)
    expect(p.style.bottom).toBeUndefined()
  })

  it('flips to top only when below does not fit', () => {
    const a = anchor({ left: 400, top: 770 }) // bottom 794, bubble 40 won't fit under 800
    const p = resolveTooltipPlacement({ side: 'bottom', anchor: a, bubble, viewport })
    expect(p.side).toBe('top')
    expect(p.style.bottom).toBe(viewport.height - a.top + 10)
    expect(p.style.top).toBeUndefined()
  })
})
