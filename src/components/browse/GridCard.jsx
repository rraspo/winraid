import { memo } from 'react'
import { Folder } from 'lucide-react'
import Thumbnail from './Thumbnail'
import EntryMenu from './EntryMenu'
import Tooltip from '../ui/Tooltip'
import { formatSize } from '../../utils/format'
import { isEditableFile } from '../../utils/fileTypes'
import styles from './GridCard.module.css'

const GridCard = memo(function GridCard({
  entry, entryPath, connectionId, isDir, busy, index,
  isSelected, isDragSource, isLastVisited, isHighlighted,
  highlightRef, onItemPointer, onNavigate, onQuickLook, onDownload, onEdit,
  onMove, onDelete, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) {
  const icon = isDir
    ? <Folder size={40} className={styles.gridIconDir} />
    : <Thumbnail name={entry.name} remotePath={entryPath} connectionId={connectionId} size="grid" />

  function handleCardClick(e) {
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
    if (isDir) onNavigate(entryPath)
    else onQuickLook(entry, entryPath)
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
        styles.gridCard,
        isDir ? styles.gridCardDir : styles.gridCardFile,
        isSelected ? styles.gridCardSelected : '',
        isDragSource ? styles.dragging : '',
        isLastVisited ? styles.lastVisited : '',
        isHighlighted ? 'shimmer shimmer-border shimmer-once' : '',
      ].join(' ')}
      draggable={!busy}
      onDragStart={(e) => onDragStart(e, entry, entryPath)}
      onDragEnd={onDragEnd}
      onDragOver={isDir ? (e) => onDragOver(e, entryPath) : undefined}
      onDragLeave={isDir ? onDragLeave : undefined}
      onDrop={isDir ? (e) => { e.stopPropagation(); onDrop(e, entryPath) } : undefined}
      onClick={handleCardClick}
    >
      <div className={styles.gridThumb}>
        {icon}
        <label className={styles.gridCheckbox} onClick={handleCheckboxClick}>
          <input type="checkbox" checked={isSelected} onChange={() => {}} />
          <span className={styles.checkmark} />
        </label>
      </div>

      <div className={styles.gridMeta}>
        <div className={styles.gridMetaRow}>
          <div className={styles.gridNameWrap}>
            <Tooltip tip={entry.name} followMouse>
              <span className={styles.gridName}>{entry.name}</span>
            </Tooltip>
          </div>
          <EntryMenu
            isDir={isDir}
            isEditable={!isDir && isEditableFile(entry.name)}
            busy={busy}
            onDownload={() => onDownload(entryPath, entry.name, isDir)}
            onEdit={() => onEdit(entryPath)}
            onMove={() => onMove({ name: entry.name, path: entryPath })}
            onDelete={() => onDelete({ name: entry.name, path: entryPath, isDir })}
          />
        </div>
        {!isDir && <span className={styles.gridSize}>{formatSize(entry.size)}</span>}
      </div>
    </div>
  )
})

export default GridCard
