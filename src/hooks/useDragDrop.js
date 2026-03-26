import { useState, useCallback, useRef, useMemo } from 'react'

// Build a stacked ghost DOM node for setDragImage.
// Uses inlined styles — CSS Modules are not available outside the React tree.
function buildGhostNode(draggingEntries, viewMode) {
  const MAX_COPIES = 3
  const copies = draggingEntries.slice(0, MAX_COPIES)
  const extra  = draggingEntries.length - MAX_COPIES

  const wrapper = document.createElement('div')
  wrapper.style.cssText = viewMode === 'grid'
    ? 'position:absolute;left:-9999px;top:-9999px;pointer-events:none;width:136px;height:56px'
    : 'position:absolute;left:-9999px;top:-9999px;pointer-events:none;width:216px;height:48px'

  const OPACITIES = [1, 0.7, 0.45]

  copies.forEach((item, i) => {
    const el = document.createElement('div')
    const offset = i * 4
    if (viewMode === 'grid') {
      el.style.cssText = [
        `position:absolute;top:${offset}px;left:${offset}px`,
        'width:120px;background:#1C2733;border-radius:8px;padding:10px',
        `border:1.5px solid ${i === 0 ? '#5BA4F5' : 'rgba(255,255,255,0.08)'}`,
        `opacity:${OPACITIES[i]};box-sizing:border-box`,
      ].join(';')
      el.innerHTML = `<div style="font-size:11px;color:#E6EDF3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.name)}</div>`
    } else {
      el.style.cssText = [
        `position:absolute;top:${offset}px;left:${offset}px`,
        'width:200px;height:32px;background:#1C2733;border-radius:4px',
        'display:flex;align-items:center;padding:0 10px;gap:8px',
        `border:1px solid ${i === 0 ? '#5BA4F5' : 'rgba(255,255,255,0.08)'}`,
        `opacity:${OPACITIES[i]};box-sizing:border-box`,
      ].join(';')
      el.innerHTML = `<span style="font-size:12px;color:#E6EDF3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.name)}</span>`
    }
    wrapper.appendChild(el)
  })

  if (extra > 0) {
    const badge = document.createElement('div')
    badge.style.cssText = [
      'position:absolute;top:-6px;right:-10px',
      'background:#5BA4F5;color:#fff;border-radius:10px',
      'font-size:10px;font-weight:700;padding:1px 6px;border:2px solid #1C2733',
    ].join(';')
    badge.textContent = `+${extra}`
    wrapper.appendChild(badge)
  }

  return wrapper
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

export function useDragDrop({ selected, entries, selectedId, path, viewMode, fetchDir, navigate = () => {}, setStatus }) {
  const [dragSource,   setDragSource]   = useState(null)
  const [moveInFlight, setMoveInFlight] = useState(null)

  const dragSourceRef     = useRef(null)
  const dropTargetPathRef = useRef(null)
  const dwellTimer        = useRef(null)
  const pathRef           = useRef(path)
  pathRef.current         = path

  // O(1) lookup for isDragSource checks in card/row components
  const dragSourcePaths = useMemo(
    () => new Set(dragSource?.entries.map((item) => item.entryPath) ?? []),
    [dragSource],
  )

  const handleDragStart = useCallback((e, entry, entryPath) => {
    const isSelectedEntry = selected.has(entry.name)
    const draggingEntries = isSelectedEntry
      ? entries
          .filter((en) => selected.has(en.name))
          .map((en) => ({ ...en, entryPath: en.entryPath ?? joinRemote(path, en.name) }))
      : [{ ...entry, entryPath }]

    const src = { entry, entryPath, entries: draggingEntries }
    dragSourceRef.current = src
    setDragSource(src)

    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', entryPath)

    const ghost = buildGhostNode(draggingEntries, viewMode)
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 16, 16)
    requestAnimationFrame(() => document.body.removeChild(ghost))
  }, [selected, entries, path, viewMode])

  const handleDragEnd = useCallback(() => {
    dragSourceRef.current = null
    setDragSource(null)
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

    dragSourceRef.current = null
    setDragSource(null)

    const firstName = src.entries[0]?.name ?? ''
    const label = src.entries.length > 1 ? `${src.entries.length} items` : firstName
    setMoveInFlight(firstName)

    let failMsg = null
    try {
      for (const item of src.entries) {
        const dstPath = joinRemote(targetDirPath, item.name)
        if (item.entryPath === dstPath) continue
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
  }, [selectedId, fetchDir, setStatus])

  return {
    dragSource,
    dragSourcePaths,
    moveInFlight,
    handleDragStart,
    handleDragEnd,
    handleDragOverFolder,
    handleDragLeaveFolder,
    handleDrop,
  }
}
