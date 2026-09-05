import { useCallback, useMemo, useState } from 'react'

// Path-keyed selection over the play wall's currently walked files.
// Ctrl/Meta+click toggles a tile and moves the anchor to it; Shift+click
// always selects the contiguous wall-order range between the anchor
// (defaulting to the first tile) and the clicked tile, replacing the
// selection — independent of the order tiles were clicked in.
export function useWallSelection(playlist) {
  const [selectedPaths, setSelectedPaths] = useState(() => new Set())
  const [anchorIndex,   setAnchorIndex]   = useState(null)

  const pathIndex = useMemo(() => {
    const index = new Map()
    playlist.forEach((file, position) => index.set(file.path, position))
    return index
  }, [playlist])

  const toggle = useCallback((path) => {
    setSelectedPaths((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    setAnchorIndex(pathIndex.get(path) ?? null)
  }, [pathIndex])

  const selectRange = useCallback((path) => {
    const targetIndex = pathIndex.get(path)
    if (targetIndex === undefined) return
    const anchor = anchorIndex ?? 0
    const low  = Math.min(anchor, targetIndex)
    const high = Math.max(anchor, targetIndex)
    setSelectedPaths(new Set(playlist.slice(low, high + 1).map((file) => file.path)))
  }, [pathIndex, anchorIndex, playlist])

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(playlist.map((file) => file.path)))
  }, [playlist])

  const clear = useCallback(() => setSelectedPaths(new Set()), [])

  // Drops the given paths from the selection, e.g. once a bulk delete/move
  // completes for them. Returns the same Set instance when nothing in
  // `paths` was actually selected, so callers never re-render on a no-op.
  const drop = useCallback((paths) => {
    if (paths.length === 0) return
    setSelectedPaths((previous) => {
      let changed = false
      const next = new Set(previous)
      for (const path of paths) {
        if (next.delete(path)) changed = true
      }
      return changed ? next : previous
    })
  }, [])

  return { selectedPaths, toggle, selectRange, selectAll, clear, drop }
}
