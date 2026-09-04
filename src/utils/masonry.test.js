import { describe, it, expect } from 'vitest'
import { layoutMasonry } from './masonry'

// Contract: layoutMasonry(items, { columnCount, columnWidth, gap })
//   items[i].ratio  — width / height of the tile's media; a falsy ratio
//                     means "unknown yet" and lays out as a square.
//   returns { positions, height }
//     positions[i] = { left, top, width, height }, one per item, same order
//     height       = total content height (tallest column, no trailing gap)
// Placement rule: each item goes into the column that is currently shortest;
// ties resolve to the leftmost column. Items never leave gaps between them
// beyond `gap`, and every tile spans exactly one column width.

const opts = { columnCount: 3, columnWidth: 100, gap: 4 }

describe('layoutMasonry', () => {
  it('returns no positions and zero height for an empty list', () => {
    const { positions, height } = layoutMasonry([], opts)
    expect(positions).toEqual([])
    expect(height).toBe(0)
  })

  it('fills the first row left to right, one tile per column', () => {
    const { positions } = layoutMasonry([{ ratio: 1 }, { ratio: 1 }, { ratio: 1 }], opts)
    expect(positions.map((p) => p.left)).toEqual([0, 104, 208])
    expect(positions.map((p) => p.top)).toEqual([0, 0, 0])
    expect(positions.every((p) => p.width === 100)).toBe(true)
  })

  it('derives tile height from column width and ratio', () => {
    const { positions } = layoutMasonry([{ ratio: 2 }, { ratio: 0.5 }, { ratio: 4 / 3 }], opts)
    expect(positions[0].height).toBe(50)
    expect(positions[1].height).toBe(200)
    expect(positions[2].height).toBe(75)
  })

  it('lays out an unknown ratio as a square placeholder', () => {
    const { positions } = layoutMasonry([{ ratio: 0 }, { ratio: undefined }, {}], opts)
    expect(positions.every((p) => p.height === 100)).toBe(true)
  })

  it('drops each following tile into the shortest column, not the next column', () => {
    // Column heights after the first row: [50, 200, 75]. The 4th tile must
    // land under the 50-tall tile in column 0, the 5th under column 2 (75),
    // the 6th back in column 0 (now 50+4+100 = 154 < 200).
    const items = [
      { ratio: 2 }, { ratio: 0.5 }, { ratio: 4 / 3 },
      { ratio: 1 }, { ratio: 1 }, { ratio: 1 },
    ]
    const { positions } = layoutMasonry(items, opts)
    expect(positions[3]).toMatchObject({ left: 0,   top: 54 })
    expect(positions[4]).toMatchObject({ left: 208, top: 79 })
    expect(positions[5]).toMatchObject({ left: 0,   top: 158 })
  })

  it('breaks height ties toward the leftmost column', () => {
    const items = [{ ratio: 1 }, { ratio: 1 }, { ratio: 1 }, { ratio: 1 }]
    const { positions } = layoutMasonry(items, opts)
    expect(positions[3]).toMatchObject({ left: 0, top: 104 })
  })

  it('reports the tallest column as the content height without a trailing gap', () => {
    const items = [{ ratio: 2 }, { ratio: 0.5 }, { ratio: 4 / 3 }, { ratio: 1 }]
    const { height } = layoutMasonry(items, opts)
    // Column 1 holds a single 200-tall tile and is still the tallest.
    expect(height).toBe(200)
  })

  it('leaves no vertical gap larger than `gap` inside any column', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ ratio: 0.5 + (i % 5) * 0.4 }))
    const { positions } = layoutMasonry(items, opts)
    const byColumn = new Map()
    for (const p of positions) {
      if (!byColumn.has(p.left)) byColumn.set(p.left, [])
      byColumn.get(p.left).push(p)
    }
    for (const column of byColumn.values()) {
      column.sort((a, b) => a.top - b.top)
      expect(column[0].top).toBe(0)
      for (let i = 1; i < column.length; i++) {
        expect(column[i].top - (column[i - 1].top + column[i - 1].height)).toBe(opts.gap)
      }
    }
  })

  it('places everything in one column when columnCount is 1', () => {
    const { positions, height } = layoutMasonry([{ ratio: 1 }, { ratio: 1 }], { ...opts, columnCount: 1 })
    expect(positions.map((p) => p.left)).toEqual([0, 0])
    expect(positions.map((p) => p.top)).toEqual([0, 104])
    expect(height).toBe(204)
  })
})
