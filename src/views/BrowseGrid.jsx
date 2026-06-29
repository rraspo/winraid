import { memo, useState, useCallback, useRef, useEffect } from 'react'
import GridCard from '../components/browse/GridCard'
import NewFolderPrompt from '../components/browse/NewFolderPrompt'
import { GRID_PAD, GRID_GAP, useGridVirtualizer } from '../hooks/useVirtualizers'
import styles from './BrowseGrid.module.css'

const BrowseGrid = memo(function BrowseGrid({
  entriesWithPaths, loading, error, newFolderName, setNewFolderName, handleCreateFolder,
  path, selectedId, busy, selected, dragSourcePaths, lastVisitedDir,
  highlightFile, highlightRef, cursorEntry,
  scrollAnchor, setScrollAnchor,
  handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  navigate, openQuickLook, handleItemPointer, toggleSelectAll,
  handleRubberBandStart, handleRubberBandMove, handleRubberBandEnd,
  rubberBand,
  handleDownload, setEditingFile, setMoveTarget, setDeleteTarget,
  localMirrorOf, checkLocalExists, onRevealLocal,
}) {
  const entries = entriesWithPaths
  const [gridScrollEl, setGridScrollEl] = useState(null)
  const { gridVirtualizer, gridCols } = useGridVirtualizer(entries, gridScrollEl)

  // On unmount, snapshot the entry name at the top of the visible window
  // so a re-mount (via list/grid toggle) can restore the same scroll
  // position. The grid virtualizer paginates by rows, so virtualItems[0]
  // is the top row; the first entry in that row is the anchor.
  const entriesRef        = useRef(entries)
  const gridVirtualizerRef = useRef(gridVirtualizer)
  const gridColsRef        = useRef(gridCols)
  entriesRef.current         = entries
  gridVirtualizerRef.current = gridVirtualizer
  gridColsRef.current        = gridCols

  useEffect(() => {
    return () => {
      const items = gridVirtualizerRef.current?.getVirtualItems?.() ?? []
      if (items.length === 0) return
      const cols = gridColsRef.current || 1
      const firstIdx = items[0].index * cols
      const entry = entriesRef.current[firstIdx]
      if (entry && setScrollAnchor) setScrollAnchor(entry.name)
    }
  }, [setScrollAnchor])

  // Restore to scrollAnchor once on mount, after entries arrive. Skipped
  // if highlightFile or lastVisitedDir wins.
  const restoredAnchor = useRef(false)
  useEffect(() => {
    if (restoredAnchor.current) return
    if (entries.length === 0 || gridCols === 0) return
    if (highlightFile || lastVisitedDir) { restoredAnchor.current = true; return }
    if (!scrollAnchor) return
    const idx = entries.findIndex((e) => e.name === scrollAnchor)
    restoredAnchor.current = true
    if (idx >= 0) gridVirtualizer.scrollToIndex(Math.floor(idx / gridCols), { align: 'start' })
  }, [scrollAnchor, entries, gridCols, highlightFile, lastVisitedDir]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll either the highlighted file (e.g. just-uploaded), the type-
  // ahead cursor target, or the subfolder we just came back up from
  // into view. Priority: highlightFile > cursorEntry > lastVisitedDir.
  const lastScrolled = useRef(null)
  useEffect(() => {
    if (entries.length === 0 || gridCols === 0) return
    const target = highlightFile || cursorEntry || lastVisitedDir
    if (!target || target === lastScrolled.current) return
    const idx = entries.findIndex((e) => e.name === target)
    if (idx < 0) return
    lastScrolled.current = target
    gridVirtualizer.scrollToIndex(Math.floor(idx / gridCols), { align: 'center' })
  }, [highlightFile, cursorEntry, lastVisitedDir, entries, gridCols]) // eslint-disable-line react-hooks/exhaustive-deps

  const isLassoing  = useRef(false)
  const lassoMods   = useRef({ ctrl: false, shift: false })
  const lassoAnchor = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
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
      const cardEls = container.querySelectorAll('[data-entry-path]')
      cardEls.forEach((el) => {
        const cr = el.getBoundingClientRect()
        const cardLeft   = cr.left - rect.left
        const cardTop    = cr.top  - rect.top  + scrollTop
        const cardRight  = cardLeft + cr.width
        const cardBottom = cardTop  + cr.height
        if (cardLeft < lx + lw && cardRight > lx && cardTop < ly + lh && cardBottom > ly) {
          const idx = entries.findIndex((entry) => entry.entryPath === el.getAttribute('data-entry-path'))
          if (idx >= 0) intersected.push(idx)
        }
      })
    }

    handleRubberBandMove(lx, ly, lw, lh, intersected, lassoMods.current)
  }, [entries, handleRubberBandMove])

  const handleMouseUp = useCallback((e) => {
    if (!isLassoing.current) return
    isLassoing.current = false

    if (!rubberBand || (rubberBand.w < 4 && rubberBand.h < 4)) {
      handleRubberBandEnd([], lassoMods.current)
      return
    }

    const containerRect = e.currentTarget.getBoundingClientRect()
    const scrollTop = e.currentTarget.scrollTop
    const lassoLeft   = rubberBand.x
    const lassoTop    = rubberBand.y
    const lassoRight  = rubberBand.x + rubberBand.w
    const lassoBottom = rubberBand.y + rubberBand.h

    const cardEls = e.currentTarget.querySelectorAll('[data-entry-path]')
    const intersected = []
    cardEls.forEach((el) => {
      const cr = el.getBoundingClientRect()
      const cardLeft   = cr.left - containerRect.left
      const cardTop    = cr.top  - containerRect.top  + scrollTop
      const cardRight  = cardLeft + cr.width
      const cardBottom = cardTop  + cr.height
      if (
        cardLeft < lassoRight && cardRight > lassoLeft &&
        cardTop  < lassoBottom && cardBottom > lassoTop
      ) {
        const entryPath = el.getAttribute('data-entry-path')
        const idx = entries.findIndex((entry) => entry.entryPath === entryPath)
        if (idx >= 0) intersected.push(idx)
      }
    })

    handleRubberBandEnd(intersected, lassoMods.current)
  }, [rubberBand, entries, handleRubberBandEnd])

  return (
    <div
      ref={setGridScrollEl}
      className={[styles.gridWrapper, selected.size > 0 ? styles.hasSelection : ''].join(' ')}
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
        <div style={{ height: gridVirtualizer.getTotalSize(), position: 'relative' }}>
          {gridVirtualizer.getVirtualItems().map((vRow) => {
            const rowStart   = vRow.index * gridCols
            const rowEntries = entries.slice(rowStart, rowStart + gridCols)
            return (
              <div
                key={vRow.index}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  transform: `translateY(${vRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gap: `${GRID_GAP}px`,
                  padding: `0 ${GRID_PAD}px`,
                  boxSizing: 'border-box',
                }}
              >
                {rowEntries.map((entry, colIdx) => {
                  const { entryPath } = entry
                  const isDir = entry.type === 'dir'
                  const entryIndex = rowStart + colIdx
                  return (
                    <GridCard
                      key={entry.name}
                      entry={entry}
                      entryPath={entryPath}
                      connectionId={selectedId}
                      isDir={isDir}
                      busy={busy}
                      index={entryIndex}
                      isSelected={selected.has(entry.name)}
                      isDragSource={dragSourcePaths.has(entryPath)}
                      isLastVisited={isDir && lastVisitedDir === entry.name}
                      isHighlighted={highlightFile === entry.name}
                      isCursor={cursorEntry === entry.name}
                      highlightRef={highlightRef}
                      onItemPointer={handleItemPointer}
                      onNavigate={navigate}
                      onQuickLook={openQuickLook}
                      onDownload={handleDownload}
                      onEdit={setEditingFile}
                      onMove={setMoveTarget}
                      onDelete={setDeleteTarget}
                      localCandidate={localMirrorOf?.(entryPath) ?? null}
                      checkLocalExists={checkLocalExists}
                      onRevealLocal={onRevealLocal}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOverFolder}
                      onDragLeave={handleDragLeaveFolder}
                      onDrop={handleDrop}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      {newFolderName !== null && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gap: `${GRID_GAP}px`,
          padding: `${GRID_PAD}px ${GRID_PAD}px`,
          boxSizing: 'border-box',
        }}>
          <NewFolderPrompt
            variant="grid"
            name={newFolderName}
            onChange={setNewFolderName}
            onCreate={handleCreateFolder}
            onCancel={() => setNewFolderName(null)}
          />
        </div>
      )}
    </div>
  )
})

export default BrowseGrid
