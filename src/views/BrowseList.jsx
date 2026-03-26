import { memo, useState, useEffect } from 'react'
import NewFolderPrompt from '../components/browse/NewFolderPrompt'
import BrowseListRow from '../components/browse/BrowseListRow'
import { useListVirtualizer } from '../hooks/useVirtualizers'
import styles from './BrowseList.module.css'

const BrowseList = memo(function BrowseList({
  entriesWithPaths, loading, error, newFolderName, setNewFolderName, handleCreateFolder,
  path, selectedId, busy, selected, dragSourcePaths, lastVisitedDir,
  highlightFile, highlightRef,
  handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  navigate, openQuickLook, handleItemPointer, toggleSelectAll,
  handleCheckout, setEditingFile, setMoveTarget, setDeleteTarget,
}) {
  const entries = entriesWithPaths
  const [listScrollEl, setListScrollEl] = useState(null)
  const { rowVirtualizer } = useListVirtualizer(entries, listScrollEl)

  useEffect(() => {
    if (!highlightFile || entries.length === 0) return
    const idx = entries.findIndex((e) => e.name === highlightFile)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' })
  }, [highlightFile, entries]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={setListScrollEl}
      className={[styles.listWrapper, selected.size > 0 ? styles.hasSelection : ''].join(' ')}
      onDragOver={(e) => { if (dragSourcePaths.size > 0) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' } }}
      onDrop={(e) => handleDrop(e, path)}
    >
      {entries.length === 0 && !loading && !error && (
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
      {newFolderName !== null && (
        <NewFolderPrompt
          variant="list"
          name={newFolderName}
          onChange={setNewFolderName}
          onCreate={handleCreateFolder}
          onCancel={() => setNewFolderName(null)}
        />
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
                highlightRef={highlightRef}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                handleDragOverFolder={handleDragOverFolder}
                handleDragLeaveFolder={handleDragLeaveFolder}
                handleDrop={handleDrop}
                navigate={navigate}
                openQuickLook={openQuickLook}
                onItemPointer={handleItemPointer}
                handleCheckout={handleCheckout}
                setEditingFile={setEditingFile}
                setMoveTarget={setMoveTarget}
                setDeleteTarget={setDeleteTarget}
              />
            )
          })}
        </div>
      )}
    </div>
  )
})

export default BrowseList
