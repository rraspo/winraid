// Gap-free masonry layout: each item is placed into whichever column is
// currently shortest (leftmost wins on a tie), so columns fill evenly
// without ever leaving a vertical gap larger than the configured `gap`.
export function layoutMasonry(items, { columnCount, columnWidth, gap }) {
  if (items.length === 0) return { positions: [], height: 0 }

  const columnNextTop = new Array(columnCount).fill(0)
  const positions = []

  for (const item of items) {
    let shortestColumnIndex = 0
    for (let columnIndex = 1; columnIndex < columnCount; columnIndex++) {
      if (columnNextTop[columnIndex] < columnNextTop[shortestColumnIndex]) {
        shortestColumnIndex = columnIndex
      }
    }

    const tileHeight = item.ratio ? Math.round(columnWidth / item.ratio) : columnWidth
    const top  = columnNextTop[shortestColumnIndex]
    const left = shortestColumnIndex * (columnWidth + gap)

    positions.push({ left, top, width: columnWidth, height: tileHeight })
    columnNextTop[shortestColumnIndex] = top + tileHeight + gap
  }

  const height = Math.max(...columnNextTop) - gap

  return { positions, height }
}
