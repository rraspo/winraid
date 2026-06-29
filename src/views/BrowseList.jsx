import { memo, useState, useEffect, useRef, useCallback } from 'react'
import NewFolderPrompt from '../components/browse/NewFolderPrompt'
import BrowseListRow from '../components/browse/BrowseListRow'
import { useListVirtualizer } from '../hooks/useVirtualizers'
import styles from './BrowseList.module.css'

const BrowseList = memo(function BrowseList({
  entriesWithPaths, loading, error, newFolderName, setNewFolderName, handleCreateFolder,
  path, selectedId, busy, selected, dragSourcePaths, lastVisitedDir,
  highlightFile, highlightRef, cursorEntry,
  scrollAnchor, setScrollAnchor,
  handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  navigate, openQuickLook, handleItemPointer, toggleSelectAll,
  handleRubberBandStart, handleRubberBandMove, handleRubberBandEnd, rubberBand,
  handleDownload, setEditingFile, setMoveTarget, setDeleteTarget,
  localMirrorOf, checkLocalExists, onRevealLocal,
}) {
  const entries = entriesWithPaths
  const [listScrollEl, setListScrollEl] = useState(null)
  const { rowVirtualizer } = useListVirtualizer(entries, listScrollEl)

  // On unmount, snapshot the entry name at the top of the visible window
  // so a re-mount (via list/grid toggle) can restore the same scroll
  // position. We capture via refs so the closed-over `entries` and
  // `rowVirtualizer` stay current at cleanup time.
  const entriesRef       = useRef(entries)
  const rowVirtualizerRef = useRef(rowVirtualizer)
  entriesRef.current        = entries
  rowVirtualizerRef.current = rowVirtualizer

  useEffect(() => {
    return () => {
      const items = rowVirtualizerRef.current?.getVirtualItems?.() ?? []
      if (items.length === 0) return
      const firstIdx = items[0].index
      const entry = entriesRef.current[firstIdx]
      if (entry && setScrollAnchor) setScrollAnchor(entry.name)
    }
  }, [setScrollAnchor])

  // Restore to scrollAnchor once on mount, after entries arrive. Skipped
  // if highlightFile or lastVisitedDir wins (those scroll handled below).
  const restoredAnchor = useRef(false)
  useEffect(() => {
    if (restoredAnchor.current) return
    if (entries.length === 0) return
    if (highlightFile || lastVisitedDir) { restoredAnchor.current = true; return }
    if (!scrollAnchor) return
    const idx = entries.findIndex((e) => e.name === scrollAnchor)
    restoredAnchor.current = true
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'start' })
  }, [scrollAnchor, entries, highlightFile, lastVisitedDir]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll either the highlighted file (e.g. just-uploaded), the type-
  // ahead cursor target, or the subfolder we just came back up from
  // into view. Priority: highlightFile > cursorEntry > lastVisitedDir.
  const lastScrolled = useRef(null)
  useEffect(() => {
    if (entries.length === 0) return
    const target = highlightFile || cursorEntry || lastVisitedDir
    if (!target || target === lastScrolled.current) return
    const idx = entries.findIndex((e) => e.name === target)
    if (idx < 0) return
    lastScrolled.current = target
    rowVirtualizer.scrollToIndex(idx, { align: 'center' })
  }, [highlightFile, cursorEntry, lastVisitedDir, entries]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rubber-band lasso selection (mirrors BrowseGrid). Drag from any
  // empty area of the list to lasso-select rows. Bails on row, checkbox,
  // or column-header clicks so normal interactions still work.
  const isLassoing  = useRef(false)
  const lassoMods   = useRef({ ctrl: false, shift: false })
  const lassoAnchor = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    if (!handleRubberBandStart) return
    if (e.target.closest('[data-entry-path]')) return
    if (e.target.closest('label')) return
    isLassoing.current = true
    lassoMods.current  = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top + e.currentTarget.scrollTop
    lassoAnchor.current = { x, y }
    handleRubberBandStart(x, y)
  }, [handleRubberBandStart])

  const handleMouseMove = useCallback((e) => {
    if (!isLassoing.current) return
    const container = e.currentTarget
    const rect = container.getBoundingClientRect()
    const scrollTop = container.scrollTop
    const x0 = lassoAnchor.current.x
    const y0 = lassoAnchor.current.y
    const x1 = e.clientX - rect.left
    const y1 = e.clientY - rect.top + scrollTop
    const lx = Math.min(x0, x1)
    const ly = Math.min(y0, y1)
    const lw = Math.abs(x1 - x0)
    const lh = Math.abs(y1 - y0)

    const intersected = []
    if (lw >= 2 && lh >= 2) {
      const rowEls = container.querySelectorAll('[data-entry-path]')
      rowEls.forEach((el) => {
        const cr = el.getBoundingClientRect()
        const rowLeft   = cr.left - rect.left
        const rowTop    = cr.top  - rect.top  + scrollTop
        const rowRight  = rowLeft + cr.width
        const rowBottom = rowTop  + cr.height
        if (rowLeft < lx + lw && rowRight > lx && rowTop < ly + lh && rowBottom > ly) {
          const idx = entries.findIndex((entry) => entry.entryPath === el.getAttribute('data-entry-path'))
          if (idx >= 0) intersected.push(idx)
        }
      })
    }

    handleRubberBandMove?.(lx, ly, lw, lh, intersected, lassoMods.current)
  }, [entries, handleRubberBandMove])

  const handleMouseUp = useCallback((e) => {
    if (!isLassoing.current) return
    isLassoing.current = false

    if (!rubberBand || (rubberBand.w < 4 && rubberBand.h < 4)) {
      handleRubberBandEnd?.([], lassoMods.current)
      return
    }

    const containerRect = e.currentTarget.getBoundingClientRect()
    const scrollTop = e.currentTarget.scrollTop
    const lassoLeft   = rubberBand.x
    const lassoTop    = rubberBand.y
    const lassoRight  = rubberBand.x + rubberBand.w
    const lassoBottom = rubberBand.y + rubberBand.h

    const rowEls = e.currentTarget.querySelectorAll('[data-entry-path]')
    const intersected = []
    rowEls.forEach((el) => {
      const cr = el.getBoundingClientRect()
      const rowLeft   = cr.left - containerRect.left
      const rowTop    = cr.top  - containerRect.top  + scrollTop
      const rowRight  = rowLeft + cr.width
      const rowBottom = rowTop  + cr.height
      if (
        rowLeft < lassoRight && rowRight > lassoLeft &&
        rowTop  < lassoBottom && rowBottom > lassoTop
      ) {
        const entryPath = el.getAttribute('data-entry-path')
        const idx = entries.findIndex((entry) => entry.entryPath === entryPath)
        if (idx >= 0) intersected.push(idx)
      }
    })

    handleRubberBandEnd?.(intersected, lassoMods.current)
  }, [rubberBand, entries, handleRubberBandEnd])

  return (
    <div
      ref={setListScrollEl}
      className={[styles.listWrapper, selected.size > 0 ? styles.hasSelection : ''].join(' ')}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragOver={(e) => { if (dragSourcePaths.size > 0) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' } }}
      onDrop={(e) => handleDrop(e, path)}
    >
      {rubberBand && rubberBand.w > 1 && rubberBand.h > 1 && (
        <div
          className={styles.lassoRect}
          style={{
            left: rubberBand.x,
            top:  rubberBand.y,
            width: rubberBand.w,
            height: rubberBand.h,
          }}
        />
      )}
      {entries.length === 0 && !loading && !error && newFolderName === null && (
        <div className={styles.emptyDir}>Empty folder</div>
      )}
      {entries.length > 0 && (
        <div className={styles.colHeader}>
          <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={entries.length > 0 && selected.size === entries.length}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < entries.length }}
              onChange={toggleSelectAll}
            />
            <span className={styles.checkmark} />
          </label>
          <span className={styles.colName}>Name</span>
          <span className={styles.colSize}>Size</span>
          <span className={styles.colDate}>Modified</span>
          <span className={styles.colActions} />
        </div>
      )}
      {entries.length > 0 && (
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index]
            return (
              <BrowseListRow
                key={entry.name}
                entry={entry}
                entryPath={entry.entryPath}
                virtualRow={virtualRow}
                index={virtualRow.index}
                connectionId={selectedId}
                busy={busy}
                isSelected={selected.has(entry.name)}
                isDragSource={dragSourcePaths.has(entry.entryPath)}
                isLastVisited={entry.type === 'dir' && lastVisitedDir === entry.name}
                isHighlighted={highlightFile === entry.name}
                isCursor={cursorEntry === entry.name}
                highlightRef={highlightRef}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                handleDragOverFolder={handleDragOverFolder}
                handleDragLeaveFolder={handleDragLeaveFolder}
                handleDrop={handleDrop}
                navigate={navigate}
                openQuickLook={openQuickLook}
                onItemPointer={handleItemPointer}
                handleDownload={handleDownload}
                setEditingFile={setEditingFile}
                setMoveTarget={setMoveTarget}
                setDeleteTarget={setDeleteTarget}
                localCandidate={localMirrorOf?.(entry.entryPath) ?? null}
                checkLocalExists={checkLocalExists}
                onRevealLocal={onRevealLocal}
              />
            )
          })}
        </div>
      )}
      {newFolderName !== null && (
        <NewFolderPrompt
          variant="list"
          name={newFolderName}
          onChange={setNewFolderName}
          onCreate={handleCreateFolder}
          onCancel={() => setNewFolderName(null)}
        />
      )}
    </div>
  )
})

export default BrowseList
