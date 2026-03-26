import { useState, useCallback, useEffect } from 'react'

export function useSelection({ entries, path }) {
  const [selected,     setSelected]     = useState(() => new Set())
  const [anchorIndex,  setAnchorIndex]  = useState(null)
  const [rubberBand,   setRubberBand]   = useState(null)

  // Auto-clear selection when navigating to a different directory
  useEffect(() => { setSelected(new Set()) }, [path])

  // Escape clears selection
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setSelected(new Set())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleItemPointer = useCallback((index, { ctrl = false, shift = false } = {}) => {
    const name = entries[index]?.name
    if (!name) return

    if (shift) {
      // Range from anchor (default 0) to index — replaces selection
      const anchor = anchorIndex ?? 0
      const lo = Math.min(anchor, index)
      const hi = Math.max(anchor, index)
      const names = entries.slice(lo, hi + 1).map((e) => e.name)
      setSelected(new Set(names))
      return
    }

    if (ctrl) {
      // Toggle this item; update anchor
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
      setAnchorIndex(index)
      return
    }

    // Plain click: replace with just this item
    setSelected(new Set([name]))
    setAnchorIndex(index)
  }, [entries, anchorIndex])

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === entries.length
        ? new Set()
        : new Set(entries.map((e) => e.name))
    )
  }, [entries])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const handleRubberBandStart = useCallback((x, y) => {
    setRubberBand({ x, y, w: 0, h: 0 })
  }, [])

  const handleRubberBandMove = useCallback((x, y, w, h) => {
    setRubberBand({ x, y, w, h })
  }, [])

  const handleRubberBandEnd = useCallback((intersectedIndexes, { ctrl = false, shift = false } = {}) => {
    setRubberBand(null)
    if (intersectedIndexes.length === 0) {
      if (!ctrl && !shift) setSelected(new Set())
      return
    }
    const names = intersectedIndexes.map((i) => entries[i]?.name).filter(Boolean)
    if (ctrl) {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const name of names) {
          if (next.has(name)) next.delete(name)
          else next.add(name)
        }
        return next
      })
    } else if (shift) {
      setSelected((prev) => new Set([...prev, ...names]))
    } else {
      setSelected(new Set(names))
    }
  }, [entries])

  return {
    selected,
    anchorIndex,
    rubberBand,
    handleItemPointer,
    handleRubberBandStart,
    handleRubberBandMove,
    handleRubberBandEnd,
    toggleSelectAll,
    clearSelection,
  }
}
