import { memo, useState } from 'react'
import GridCard from '../components/browse/GridCard'
import NewFolderPrompt from '../components/browse/NewFolderPrompt'
import { GRID_PAD, GRID_GAP, useGridVirtualizer } from '../hooks/useVirtualizers'
import styles from './BrowseGrid.module.css'

const BrowseGrid = memo(function BrowseGrid({
  entriesWithPaths, loading, error, newFolderName, setNewFolderName, handleCreateFolder,
  path, selectedId, busy, selected, dragSource, lastVisitedDir,
  highlightFile, highlightRef,
  handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  navigate, openQuickLook, toggleSelect,
  handleCheckout, setEditingFile, setMoveTarget, setDeleteTarget,
}) {
  const entries = entriesWithPaths
  const [gridScrollEl, setGridScrollEl] = useState(null)
  const { gridVirtualizer, gridCols, gridRowH } = useGridVirtualizer(entries, gridScrollEl)

  return (
    <div
      ref={setGridScrollEl}
      className={[styles.gridWrapper, selected.size > 0 ? styles.hasSelection : ''].join(' ')}
      onDragOver={(e) => { if (dragSource) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' } }}
      onDrop={(e) => handleDrop(e, path)}
    >
      {newFolderName !== null && (
        <NewFolderPrompt
          variant="grid"
          name={newFolderName}
          gridPad={GRID_PAD}
          onChange={setNewFolderName}
          onCreate={handleCreateFolder}
          onCancel={() => setNewFolderName(null)}
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
                {rowEntries.map((entry) => {
                  const { entryPath } = entry
                  const isDir = entry.type === 'dir'
                  return (
                    <GridCard
                      key={entry.name}
                      entry={entry}
                      entryPath={entryPath}
                      connectionId={selectedId}
                      isDir={isDir}
                      busy={busy}
                      isSelected={selected.has(entry.name)}
                      isDragSource={dragSource?.path === entryPath}
                      isLastVisited={isDir && lastVisitedDir === entry.name}
                      isHighlighted={highlightFile === entry.name}
                      highlightRef={highlightRef}
                      onSelect={toggleSelect}
                      onNavigate={navigate}
                      onQuickLook={openQuickLook}
                      onCheckout={handleCheckout}
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
    </div>
  )
})

export default BrowseGrid
