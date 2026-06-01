import { memo, useRef } from 'react'
import { Folder } from 'lucide-react'
import Thumbnail from './Thumbnail'
import EntryMenu from './EntryMenu'
import Tooltip from '../ui/Tooltip'
import { formatSize } from '../../utils/format'
import { isEditableFile } from '../../utils/fileTypes'
import styles from './GridCard.module.css'

const GridCard = memo(function GridCard({
  entry, entryPath, connectionId, isDir, busy, index,
  isSelected, isDragSource, isLastVisited, isHighlighted, isCursor,
  highlightRef, onItemPointer, onNavigate, onQuickLook, onDownload, onEdit,
  onMove, onDelete, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) {
  const menuRef = useRef(null)
  const icon = isDir
    ? <Folder size={40} className={styles.gridIconDir} />
    : <Thumbnail name={entry.name} remotePath={entryPath} connectionId={connectionId} size="grid" modified={entry.modified} />

  function handleCardClick(e) {
    // Drop the 2nd+ click of a double-click — the row at this DOM position
    // becomes a different file after click 1 navigates / opens, and letting
    // click 2 through would target the wrong path.
    if (e.detail > 1) return
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
        isCursor ? styles.cursor : '',
        isHighlighted ? 'shimmer shimmer-border shimmer-once' : '',
      ].join(' ')}
      draggable={!busy}
      onDragStart={(e) => onDragStart(e, entry, entryPath)}
      onDragEnd={onDragEnd}
      onDragOver={isDir ? (e) => onDragOver(e, entryPath) : undefined}
      onDragLeave={isDir ? onDragLeave : undefined}
      onDrop={isDir ? (e) => {
        // Only handle internal moves at the card level; external drags
        // (Windows / browser files) must bubble up to the BrowseView
        // container's external-drop handler so the "drop overlay = current
        // directory" contract holds.
        if (!e.dataTransfer?.types?.includes('application/x-winraid-internal')) return
        e.stopPropagation()
        onDrop(e, entryPath)
      } : undefined}
      onClick={handleCardClick}
      onContextMenu={(e) => {
        if (busy) return
        e.preventDefault()
        menuRef.current?.openAt(e.clientX, e.clientY)
      }}
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
            ref={menuRef}
            isDir={isDir}
            isEditable={!isDir && isEditableFile(entry.name)}
            busy={busy}
            onDownload={() => onDownload(entryPath, entry.name, isDir)}
            onEdit={() => onEdit(entryPath)}
            onMove={() => onMove({ name: entry.name, path: entryPath, isDir })}
            onDelete={() => onDelete({ name: entry.name, path: entryPath, isDir })}
          />
        </div>
        {!isDir && <span className={styles.gridSize}>{formatSize(entry.size)}</span>}
      </div>
    </div>
  )
})

export default GridCard
