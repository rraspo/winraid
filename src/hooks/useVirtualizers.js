import { useState, useEffect, useLayoutEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

export const GRID_PAD      = 16
export const GRID_GAP      = 12
const        GRID_CARD_MIN = 120
const        GRID_META_H   = 56

export function useGridVirtualizer(entries, gridScrollEl) {
  const [gridWidth, setGridWidth] = useState(0)

  useLayoutEffect(() => {
    if (!gridScrollEl) return
    setGridWidth(gridScrollEl.clientWidth)
  }, [gridScrollEl])

  useEffect(() => {
    if (!gridScrollEl) return
    const ro = new ResizeObserver(([entry]) => {
      setGridWidth(entry.contentBoxSize?.[0]?.inlineSize ?? gridScrollEl.clientWidth)
    })
    ro.observe(gridScrollEl)
    return () => ro.disconnect()
  }, [gridScrollEl])

  const gridCols  = Math.max(1, Math.floor((gridWidth - GRID_PAD * 2 + GRID_GAP) / (GRID_CARD_MIN + GRID_GAP)))
  const gridCardW = (gridWidth - GRID_PAD * 2 - GRID_GAP * (gridCols - 1)) / gridCols
  const gridRowH  = Math.round(gridCardW) + GRID_META_H

  const gridVirtualizer = useVirtualizer({
    count: Math.ceil(entries.length / gridCols),
    getScrollElement: () => gridScrollEl,
    estimateSize: () => gridRowH,
    gap: GRID_GAP,
    paddingStart: GRID_PAD,
    paddingEnd: GRID_PAD,
    overscan: 5,
  })

  useEffect(() => {
    gridVirtualizer.measure()
  }, [gridRowH, gridCols]) // eslint-disable-line react-hooks/exhaustive-deps

  return { gridVirtualizer, gridCols, gridRowH }
}

export function useListVirtualizer(entries, listScrollEl) {
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listScrollEl,
    estimateSize: () => 41,
    overscan: 15,
  })

  return { rowVirtualizer }
}
