import { memo, useState, useCallback, useRef, useEffect } from 'react'
import GridCard from '../components/browse/GridCard'
import NewFolderPrompt from '../components/browse/NewFolderPrompt'
import { GRID_PAD, GRID_GAP, useGridVirtualizer } from '../hooks/useVirtualizers'
import styles from './BrowseGrid.module.css'

const BrowseGrid = memo(function BrowseGrid({
  entriesWithPaths, loading, error, newFolderName, setNewFolderName, handleCreateFolder,
  path, selectedId, busy, selected, dragSourcePaths, lastVisitedDir,
  highlightFile, highlightRef,
  handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  navigate, openQuickLook, handleItemPointer, toggleSelectAll,
  handleRubberBandStart, handleRubberBandMove, handleRubberBandEnd,
  rubberBand,
  handleDownload, setEditingFile, setMoveTarget, setDeleteTarget,
}) {
  const entries = entriesWithPaths
  const [gridScrollEl, setGridScrollEl] = useState(null)
  const { gridVirtualizer, gridCols } = useGridVirtualizer(entries, gridScrollEl)

  const lastScrolled = useRef(null)
  useEffect(() => {
    if (!highlightFile || entries.length === 0 || gridCols === 0) return
    if (highlightFile === lastScrolled.current) return
    const idx = entries.findIndex((e) => e.name === highlightFile)
    if (idx < 0) return
    lastScrolled.current = highlightFile
    gridVirtualizer.scrollToIndex(Math.floor(idx / gridCols), { align: 'center' })
  }, [highlightFile, entries, gridCols]) // eslint-disable-line react-hooks/exhaustive-deps

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
                      highlightRef={highlightRef}
                      onItemPointer={handleItemPointer}
                      onNavigate={navigate}
                      onQuickLook={openQuickLook}
                      onDownload={handleDownload}
                      onEdit={setEditingFile}
                      onMove={setMoveTarget}
                      onDelete={setDeleteTarget}
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
