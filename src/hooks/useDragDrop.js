import { useState, useCallback, useEffect, useRef, useMemo } from 'react'

// Suppress the browser's native drag image — we render our own React
// overlay (DragGhost) tracking the cursor instead. A 1×1 transparent GIF
// works on every browser; cached at module scope so we only create it
// once across the lifetime of the app.
const TRANSPARENT_DRAG_IMAGE = (() => {
  if (typeof Image === 'undefined') return null
  const img = new Image(1, 1)
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  return img
})()

function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

export function useDragDrop({ selected, entries, selectedId, path, viewMode, fetchDir, navigate = () => {}, setStatus, clearSelection = () => {} }) {
  const [dragSource,   setDragSource]   = useState(null)
  const [dragPos,      setDragPos]      = useState(null)
  const [moveInFlight, setMoveInFlight] = useState(null)

  const dragSourceRef     = useRef(null)
  const dragPosRef        = useRef(null)
  const dragRafRef        = useRef(null)
  const dropTargetPathRef = useRef(null)
  const dwellTimer        = useRef(null)
  const pathRef           = useRef(path)
  pathRef.current         = path

  // O(1) lookup for isDragSource checks in card/row components
  const dragSourcePaths = useMemo(
    () => new Set(dragSource?.entries.map((item) => item.entryPath) ?? []),
    [dragSource],
  )

  // Track cursor during drag to position the React-rendered ghost overlay.
  // dragover fires very frequently on mouse movement; rAF coalesces multiple
  // events into one state update per frame. The listener is registered for
  // the lifetime of the hook and gates on dragSourceRef so it only emits
  // updates while a drag is in progress.
  useEffect(() => {
    function onDocDragOver(e) {
      if (!dragSourceRef.current) return
      dragPosRef.current = { x: e.clientX, y: e.clientY }
      if (dragRafRef.current) return
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null
        setDragPos(dragPosRef.current)
      })
    }
    document.addEventListener('dragover', onDocDragOver)
    return () => {
      document.removeEventListener('dragover', onDocDragOver)
      if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current)
    }
  }, [])

  const handleDragStart = useCallback((e, entry, entryPath) => {
    const isSelectedEntry = selected.has(entry.name)
    const draggingEntries = isSelectedEntry
      ? entries
          .filter((en) => selected.has(en.name))
          .map((en) => ({ ...en, entryPath: en.entryPath ?? joinRemote(path, en.name) }))
      : [{ ...entry, entryPath }]

    // Capture the card geometry + click offset so the ghost lines up with
    // the card the user actually grabbed. Falls back to defaults when the
    // event lacks currentTarget (notably in unit tests with mock events).
    const rect = e.currentTarget?.getBoundingClientRect?.() ?? null
    const cardSize    = rect ? { width: rect.width, height: rect.height } : null
    const clickOffset = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null

    const src = { entry, entryPath, entries: draggingEntries, cardSize, clickOffset }
    dragSourceRef.current = src
    setDragSource(src)
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      dragPosRef.current = { x: e.clientX, y: e.clientY }
      setDragPos(dragPosRef.current)
    }

    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-winraid-internal', '1')
    e.dataTransfer.setData('text/plain', entryPath)

    // Suppress the native drag image — DragGhost renders our overlay.
    if (TRANSPARENT_DRAG_IMAGE) {
      e.dataTransfer.setDragImage(TRANSPARENT_DRAG_IMAGE, 0, 0)
    }
  }, [selected, entries, path])

  const handleDragEnd = useCallback(() => {
    dragSourceRef.current = null
    dragPosRef.current = null
    setDragSource(null)
    setDragPos(null)
    if (dropTargetPathRef.current !== null) {
      const el = document.querySelector(`[data-entry-path="${CSS.escape(dropTargetPathRef.current)}"]`)
      if (el) el.removeAttribute('data-drop-target')
      dropTargetPathRef.current = null
    }
    clearTimeout(dwellTimer.current)
  }, [])

  const handleDragOverFolder = useCallback((e, folderPath) => {
    const src = dragSourceRef.current
    if (!src) return
    // Prevent dropping onto a source item itself
    if (src.entries.some((item) => item.entryPath === folderPath)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (dropTargetPathRef.current !== folderPath) {
      if (dropTargetPathRef.current !== null) {
        const prev = document.querySelector(`[data-entry-path="${CSS.escape(dropTargetPathRef.current)}"]`)
        if (prev) prev.removeAttribute('data-drop-target')
      }
      e.currentTarget.setAttribute('data-drop-target', 'true')
      dropTargetPathRef.current = folderPath
      clearTimeout(dwellTimer.current)
      if (folderPath !== pathRef.current) {
        dwellTimer.current = setTimeout(() => navigate(folderPath), 600)
      }
    }
  }, [navigate])

  const handleDragLeaveFolder = useCallback((e) => {
    e.currentTarget.removeAttribute('data-drop-target')
    dropTargetPathRef.current = null
    clearTimeout(dwellTimer.current)
  }, [])

  const handleDrop = useCallback(async (e, targetDirPath) => {
    e.preventDefault()
    if (dropTargetPathRef.current !== null) {
      const el = document.querySelector(`[data-entry-path="${CSS.escape(dropTargetPathRef.current)}"]`)
      if (el) el.removeAttribute('data-drop-target')
      dropTargetPathRef.current = null
    }
    clearTimeout(dwellTimer.current)

    const src = dragSourceRef.current
    if (!src || !selectedId) return

    // Skip if dropping onto one of the source items or a child of them
    const isInvalidTarget = src.entries.some(
      (item) => targetDirPath === item.entryPath || targetDirPath.startsWith(item.entryPath + '/')
    )
    if (isInvalidTarget) return

    // Filter to items whose destination differs from their current path —
    // dropping a file back onto its existing parent is a no-op and should
    // not surface a "Moved X" status or trigger a directory refresh.
    const itemsToMove = src.entries.filter(
      (item) => joinRemote(targetDirPath, item.name) !== item.entryPath
    )
    if (itemsToMove.length === 0) return

    dragSourceRef.current = null
    dragPosRef.current = null
    setDragSource(null)
    setDragPos(null)
    clearSelection()

    const firstName = itemsToMove[0].name
    const label = itemsToMove.length > 1 ? `${itemsToMove.length} items` : firstName
    setMoveInFlight(firstName)

    let failMsg = null
    try {
      for (const item of itemsToMove) {
        const dstPath = joinRemote(targetDirPath, item.name)
        const res = await window.winraid?.remote.move(selectedId, item.entryPath, dstPath)
        if (!res?.ok && failMsg === null) failMsg = res?.error || 'Move failed'
      }
    } finally {
      setMoveInFlight(null)
      await fetchDir(pathRef.current)
    }
    if (failMsg !== null) {
      setStatus?.({ ok: false, msg: failMsg })
    } else {
      setStatus?.({ ok: true, msg: `Moved ${label}` })
    }
  }, [selectedId, fetchDir, setStatus, clearSelection])

  return {
    dragSource,
    dragPos,
    dragSourcePaths,
    moveInFlight,
    handleDragStart,
    handleDragEnd,
    handleDragOverFolder,
    handleDragLeaveFolder,
    handleDrop,
  }
}
