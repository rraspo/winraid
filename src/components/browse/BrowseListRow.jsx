import { memo } from 'react'
import { Folder, File } from 'lucide-react'
import Thumbnail from './Thumbnail'
import EntryMenu from './EntryMenu'
import { formatSize, formatDate } from '../../utils/format'
import { isImageFile, isVideoFile, isEditableFile } from '../../utils/fileTypes'
import styles from '../../views/BrowseList.module.css'

const BrowseListRow = memo(function BrowseListRow({
  entry, entryPath, virtualRow, connectionId, index,
  busy, isSelected, isDragSource, isLastVisited, isHighlighted, highlightRef,
  handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  navigate, openQuickLook, onItemPointer,
  selectedCount, totalCount, onToggleSelectAll,
  handleDownload, setEditingFile, setMoveTarget, setDeleteTarget,
}) {
  const isDir = entry.type === 'dir'
  const icon = isDir
    ? <Folder size={14} className={styles.iconDir} />
    : (isImageFile(entry.name) || isVideoFile(entry.name))
      ? <Thumbnail name={entry.name} remotePath={entryPath} connectionId={connectionId} size="list" />
      : <File size={14} className={styles.iconFile} />

  function handleRowClick(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      onItemPointer(index, { ctrl: true })
      return
    }
    if (e.shiftKey) {
      e.preventDefault()
      onItemPointer(index, { shift: true })
      return
    }
    if (isDir) navigate(entryPath)
    else openQuickLook(entry, entryPath)
  }

  function handleCheckboxClick(e) {
    e.stopPropagation()
    e.preventDefault()
    onItemPointer(index, { ctrl: true })
  }

  return (
    <div
      ref={isHighlighted ? highlightRef : undefined}
      data-entry-path={entryPath}
      className={[
        styles.row,
        isDir ? styles.rowDir : '',
        isSelected ? styles.rowSelected : '',
        isDragSource ? styles.dragging : '',
        isLastVisited ? styles.lastVisited : '',
        isHighlighted ? 'shimmer shimmer-border shimmer-once' : '',
      ].join(' ')}
      style={{
        position: 'absolute',
        top: 0, left: 0, width: '100%',
        height: virtualRow.size,
        transform: `translateY(${virtualRow.start}px)`,
        cursor: !isDir ? 'pointer' : undefined,
      }}
      draggable={!busy}
      onDragStart={(e) => handleDragStart(e, entry, entryPath)}
      onDragEnd={handleDragEnd}
      onDragOver={isDir ? (e) => handleDragOverFolder(e, entryPath) : undefined}
      onDragLeave={isDir ? handleDragLeaveFolder : undefined}
      onDrop={isDir ? (e) => { e.stopPropagation(); handleDrop(e, entryPath) } : undefined}
      onClick={handleRowClick}
    >
      <label className={styles.checkbox} onClick={handleCheckboxClick}>
        <input type="checkbox" checked={isSelected} onChange={() => {}} />
        <span className={styles.checkmark} />
      </label>
      <div className={styles.rowName}>
        {icon}
        {isDir ? (
          <button className={styles.nameBtn} onClick={(e) => { e.stopPropagation(); navigate(entryPath) }}>
            {entry.name}
          </button>
        ) : (
          <span className={styles.nameText}>{entry.name}</span>
        )}
      </div>
      <span className={styles.rowSize}>{isDir ? '\u2014' : formatSize(entry.size)}</span>
      <span className={styles.rowDate}>{formatDate(entry.modified)}</span>
      <div className={styles.rowActions}>
        <EntryMenu
          isDir={isDir}
          isEditable={!isDir && isEditableFile(entry.name)}
          busy={busy}
          selectedCount={selectedCount}
          totalCount={totalCount}
          onToggleSelectAll={onToggleSelectAll}
          onDownload={() => handleDownload(entryPath, entry.name, isDir)}
          onEdit={() => setEditingFile(entryPath)}
          onMove={() => setMoveTarget({ name: entry.name, path: entryPath })}
          onDelete={() => setDeleteTarget({ name: entry.name, path: entryPath, isDir })}
        />
      </div>
    </div>
  )
})

export default BrowseListRow
