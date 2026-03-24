import { memo } from 'react'
import { Folder } from 'lucide-react'
import Thumbnail from './Thumbnail'
import EntryMenu from './EntryMenu'
import Tooltip from '../ui/Tooltip'
import { formatSize } from '../../utils/format'
import { isEditableFile } from '../../utils/fileTypes'
import styles from './GridCard.module.css'

const GridCard = memo(function GridCard({
  entry, entryPath, connectionId, isDir, busy,
  isSelected, isDragSource, isDropTarget, isLastVisited, isHighlighted,
  highlightRef, onSelect, onNavigate, onQuickLook, onCheckout, onEdit,
  onMove, onDelete, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) {
  const icon = isDir
    ? <Folder size={40} className={styles.gridIconDir} />
    : <Thumbnail name={entry.name} remotePath={entryPath} connectionId={connectionId} size="grid" />

  return (
    <div
      ref={isHighlighted ? highlightRef : undefined}
      className={[
        styles.gridCard,
        isDir ? styles.gridCardDir : styles.gridCardFile,
        isSelected ? styles.gridCardSelected : '',
        isDragSource ? styles.dragging : '',
        isDropTarget ? styles.dropTarget : '',
        isLastVisited ? styles.lastVisited : '',
        isHighlighted ? 'shimmer shimmer-border shimmer-once' : '',
      ].join(' ')}
      draggable={!busy}
      onDragStart={(e) => onDragStart(e, entry, entryPath)}
      onDragEnd={onDragEnd}
      onDragOver={isDir ? (e) => onDragOver(e, entryPath) : undefined}
      onDragLeave={isDir ? onDragLeave : undefined}
      onDrop={isDir ? (e) => { e.stopPropagation(); onDrop(e, entryPath) } : undefined}
      onClick={isDir ? () => onNavigate(entryPath) : () => onQuickLook(entry, entryPath)}
    >
      <div className={styles.gridThumb}>
        {icon}
        <label className={styles.gridCheckbox} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={(e) => onSelect(entry.name, e)} />
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
            onCheckout={() => onCheckout(entryPath)}
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
