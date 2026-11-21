// Justified rows: every tile in a row shares one height and takes the width
// its shape needs, and each finished row is scaled to span the wall exactly.
// Rows are filled greedily in order, so appending files only ever touches
// the last row; rows the person has scrolled past never move.
export function layoutJustifiedRows(items, { width, targetHeight, tolerance, gap }) {
  const positions = new Array(items.length)
  let top = 0
  let start = 0

  while (start < items.length) {
    const row = []
    let ratioSum = 0
    let cursor = start
    let finished = false

    while (cursor < items.length) {
      const ratio = items[cursor].ratio
      const naturalWidth = (ratioSum + ratio) * targetHeight + row.length * gap
      if (naturalWidth <= width) {
        row.push(cursor); ratioSum += ratio; cursor++
        continue
      }
      if (row.length === 0) {
        // Wider than the wall at the target height: a row of its own.
        row.push(cursor); ratioSum += ratio; cursor++
        finished = true
        break
      }
      const shrinkWith     = (width - row.length * gap) / ((ratioSum + ratio) * targetHeight)
      const stretchWithout = (width - (row.length - 1) * gap) / (ratioSum * targetHeight)
      const shrinkAllowed  = shrinkWith >= 1 - tolerance
      const stretchAllowed = stretchWithout <= 1 + tolerance
      const shrinkIsCloser = Math.abs(Math.log(shrinkWith)) <= Math.abs(Math.log(stretchWithout))
      const takeIt = shrinkAllowed && stretchAllowed ? shrinkIsCloser : shrinkAllowed || (!stretchAllowed && shrinkIsCloser)
      if (takeIt) { row.push(cursor); ratioSum += ratio; cursor++ }
      finished = true
      break
    }

    const fittedHeight = (width - (row.length - 1) * gap) / ratioSum
    const rowHeight = Math.round(finished ? fittedHeight : Math.min(targetHeight, fittedHeight))

    // Round on the running edge so the last tile lands exactly on `width`.
    let exactLeft = 0
    for (const index of row) {
      const exactWidth = items[index].ratio * (finished ? fittedHeight : rowHeight)
      const left = Math.round(exactLeft)
      positions[index] = { left, top, width: Math.round(exactLeft + exactWidth) - left, height: rowHeight }
      exactLeft += exactWidth + gap
    }

    top += rowHeight + gap
    start = cursor
  }

  return { positions, height: Math.max(0, top - gap) }
}
