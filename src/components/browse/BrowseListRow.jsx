import { memo } from 'react'
import { Folder, File } from 'lucide-react'
import Thumbnail from './Thumbnail'
import EntryMenu from './EntryMenu'
import { formatSize, formatDate } from '../../utils/format'
import { isImageFile, isVideoFile, isEditableFile } from '../../utils/fileTypes'
import styles from '../../views/BrowseList.module.css'

const BrowseListRow = memo(function BrowseListRow({
  entry, entryPath, virtualRow, connectionId,
  busy, isSelected, isDragSource, isLastVisited, isHighlighted, highlightRef,
  handleDragStart, handleDragEnd, handleDragOverFolder, handleDragLeaveFolder, handleDrop,
  navigate, openQuickLook, toggleSelect,
  handleCheckout, setEditingFile, setMoveTarget, setDeleteTarget,
}) {
  const isDir = entry.type === 'dir'
  const icon = isDir
    ? <Folder size={14} className={styles.iconDir} />
    : (isImageFile(entry.name) || isVideoFile(entry.name))
      ? <Thumbnail name={entry.name} remotePath={entryPath} connectionId={connectionId} size="list" />
      : <File size={14} className={styles.iconFile} />

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
      onClick={!isDir ? () => openQuickLook(entry, entryPath) : undefined}
    >
      <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => toggleSelect(entry.name, e)}
        />
        <span className={styles.checkmark} />
      </label>
      <div className={styles.rowName}>
        {icon}
        {isDir ? (
          <button className={styles.nameBtn} onClick={() => navigate(entryPath)}>
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
          onCheckout={() => handleCheckout(entryPath)}
          onEdit={() => setEditingFile(entryPath)}
          onMove={() => setMoveTarget({ name: entry.name, path: entryPath })}
          onDelete={() => setDeleteTarget({ name: entry.name, path: entryPath, isDir })}
        />
      </div>
    </div>
  )
})

export default BrowseListRow
