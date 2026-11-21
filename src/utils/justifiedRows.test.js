import { describe, it, expect } from 'vitest'
import { layoutJustifiedRows } from './justifiedRows'

// Contract: layoutJustifiedRows(items, { width, targetHeight, tolerance, gap })
//   items[i].ratio — width / height of the tile's media (must be known)
//   returns { positions, height }
//     positions[i] = { left, top, width, height }, one per item, same order
//     height       = total content height (no trailing gap)
// Rows are filled greedily in order. A finished row is scaled so it spans
// `width` exactly; every tile in a row shares one height. A row stops before
// the file that would shrink it past `1 - tolerance`, unless stretching the
// shorter row would go past `1 + tolerance` and shrinking is the smaller
// change. A file wider than `width` at `targetHeight` gets a row of its own.
// The last row, still waiting for files, keeps `targetHeight`.

const opts = { width: 1000, targetHeight: 200, tolerance: 0.25, gap: 10 }

function rowsOf(positions) {
  const rows = new Map()
  for (const position of positions) {
    if (!rows.has(position.top)) rows.set(position.top, [])
    rows.get(position.top).push(position)
  }
  return [...rows.values()]
}

function rightEdge(row) {
  const last = row[row.length - 1]
  return last.left + last.width
}

describe('layoutJustifiedRows', () => {
  it('returns no positions and zero height for an empty list', () => {
    expect(layoutJustifiedRows([], opts)).toEqual({ positions: [], height: 0 })
  })

  it('scales a full row so it spans the width exactly, every tile at one height', () => {
    // Natural widths at 200px: 356 + 356 + 356 = 1068 + 20 gap, over 1000.
    // Shrinking to fit all three (0.92) beats stretching two (1.38).
    const items = [{ ratio: 16 / 9 }, { ratio: 16 / 9 }, { ratio: 16 / 9 }, { ratio: 1 }]
    const { positions } = layoutJustifiedRows(items, opts)
    const [firstRow] = rowsOf(positions)
    expect(firstRow).toHaveLength(3)
    expect(firstRow[0].left).toBe(0)
    expect(rightEdge(firstRow)).toBe(1000)
    expect(new Set(firstRow.map((position) => position.height)).size).toBe(1)
    expect(firstRow[0].height).toBeLessThan(200)
    expect(firstRow[1].left).toBe(firstRow[0].width + 10)
  })

  it('gives a wide video several times the width of a reel in the same row', () => {
    const items = [{ ratio: 16 / 9 }, { ratio: 9 / 16 }, { ratio: 4 / 3 }, { ratio: 9 / 16 }, { ratio: 16 / 9 }]
    const { positions } = layoutJustifiedRows(items, opts)
    expect(positions[0].top).toBe(positions[1].top)
    expect(positions[0].width / positions[1].width).toBeCloseTo((16 / 9) / (9 / 16), 1)
  })

  it('stops a row and stretches it when adding the next file would shrink it past the limit', () => {
    // Four squares at 200px are 830px wide. Adding a 3:1 panorama shrinks
    // the row to 0.69 (past 0.75); stretching the four squares is 1.21
    // (within 1.25), so the row stops at four and stretches.
    const items = [{ ratio: 1 }, { ratio: 1 }, { ratio: 1 }, { ratio: 1 }, { ratio: 3 }]
    const { positions } = layoutJustifiedRows(items, opts)
    const [firstRow, secondRow] = rowsOf(positions)
    expect(firstRow).toHaveLength(4)
    expect(rightEdge(firstRow)).toBe(1000)
    expect(firstRow[0].height).toBeGreaterThan(200)
    expect(secondRow).toHaveLength(1)
  })

  it('takes the smaller change when both shrinking and stretching are past the limit', () => {
    // Two 16:9 + a 21:9 shrinks to 0.83; the 16:9 pair alone stretches to
    // 1.39. With a 10% limit both are refused, and shrinking is closer.
    const items = [{ ratio: 16 / 9 }, { ratio: 16 / 9 }, { ratio: 21 / 9 }, { ratio: 1 }]
    const { positions } = layoutJustifiedRows(items, { ...opts, tolerance: 0.1 })
    const [firstRow] = rowsOf(positions)
    expect(firstRow).toHaveLength(3)
    expect(rightEdge(firstRow)).toBe(1000)
  })

  it('gives a file wider than the wall its own row, fitted to the width', () => {
    // The four squares close their row by stretching (1.21), so the 6:1
    // panorama starts a row, is wider than the wall at 200px, and fills it.
    const items = [{ ratio: 1 }, { ratio: 1 }, { ratio: 1 }, { ratio: 1 }, { ratio: 6 }, { ratio: 1 }]
    const { positions } = layoutJustifiedRows(items, opts)
    const panorama = positions[4]
    expect(panorama.left).toBe(0)
    expect(panorama.width).toBe(1000)
    expect(panorama.height).toBe(Math.round(1000 / 6))
    expect(positions[3].top).toBeLessThan(panorama.top)
    expect(positions[5].top).toBeGreaterThan(panorama.top)
    expect(positions[5].left).toBe(0)
  })

  it('keeps the last, unfinished row at the target height, left-aligned', () => {
    const items = [{ ratio: 1 }, { ratio: 1 }]
    const { positions, height } = layoutJustifiedRows(items, opts)
    expect(positions).toEqual([
      { left: 0,   top: 0, width: 200, height: 200 },
      { left: 210, top: 0, width: 200, height: 200 },
    ])
    expect(height).toBe(200)
  })

  it('stacks rows with the gap between them and reports the total height', () => {
    const items = Array.from({ length: 7 }, () => ({ ratio: 1 }))
    // 4 squares at 200 = 830 < 1000; the 5th makes 1040 → shrink 0.96 wins.
    const { positions, height } = layoutJustifiedRows(items, opts)
    const rows = rowsOf(positions)
    expect(rows.map((row) => row.length)).toEqual([5, 2])
    expect(rows[1][0].top).toBe(rows[0][0].height + 10)
    expect(height).toBe(rows[1][0].top + 200)
  })

  it('never moves a finished row when more files are appended', () => {
    const first  = Array.from({ length: 6 }, (_, index) => ({ ratio: index % 2 ? 16 / 9 : 9 / 16 }))
    const more   = [...first, { ratio: 4 / 3 }, { ratio: 1 }, { ratio: 16 / 9 }]
    const before = layoutJustifiedRows(first, opts).positions
    const after  = layoutJustifiedRows(more, opts).positions
    const finishedRowTop = rowsOf(before).at(-1)[0].top
    before.forEach((position, index) => {
      if (position.top < finishedRowTop) expect(after[index]).toEqual(position)
    })
  })
})
