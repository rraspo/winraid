import { useState } from 'react'
import { X, FileText } from 'lucide-react'
import ConnectionIcon from './ConnectionIcon'
import Tooltip from './ui/Tooltip'
import styles from './TabBar.module.css'

const DRAG_MIME = 'application/x-winraid-tab'

export default function TabBar({ openTabs, activeTabId, connections, dirtyTabs, onActivate, onClose, onReorder }) {
  // `dragId` names the tab currently being dragged; `overIndex` is the array
  // slot the insertion indicator sits in front of (0..openTabs.length, the
  // same range `Array.prototype.splice` accepts). Both live only for the
  // duration of one drag gesture and never touch tab identity or order by
  // themselves — only a `drop` does that, via `onReorder`.
  const [dragId,    setDragId]    = useState(null)
  const [overIndex, setOverIndex] = useState(null)

  if (!openTabs.length) return null

  const connMap = Object.fromEntries((connections ?? []).map((c) => [c.id, c]))

  function resetDrag() {
    setDragId(null)
    setOverIndex(null)
  }

  // A drag that begins on the close button must never become a tab drag —
  // the button already owns that mouse gesture (it closes on click), and
  // letting the ancestor's `draggable` win would silently swallow the close
  // and leave the user dragging a tab they only meant to dismiss.
  function handleDragStart(e, tab, index) {
    if (e.target.closest('button')) {
      e.preventDefault()
      return
    }
    e.dataTransfer?.setData?.(DRAG_MIME, tab.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    setDragId(tab.id)
    setOverIndex(index)
  }

  function handleTabDragOver(e, index) {
    e.preventDefault()
    e.stopPropagation()
    if (dragId == null) return
    setOverIndex(index)
  }

  function handleTabDrop(e, targetId, index) {
    e.preventDefault()
    e.stopPropagation()
    if (dragId != null) {
      const fromIndex = openTabs.findIndex((t) => t.id === dragId)
      if (fromIndex !== -1) onReorder?.(fromIndex, index)
    }
    resetDrag()
  }

  // A drop that lands on the strip itself rather than on a specific tab
  // (empty space past the last one) reads as "put it at the end" — the
  // clamp on the receiving side is what actually keeps this in range.
  function handleContainerDragOver(e) {
    e.preventDefault()
    if (e.target !== e.currentTarget || dragId == null) return
    setOverIndex(openTabs.length)
  }

  function handleContainerDrop(e) {
    e.preventDefault()
    if (e.target !== e.currentTarget) return
    if (dragId != null) {
      const fromIndex = openTabs.findIndex((t) => t.id === dragId)
      if (fromIndex !== -1) onReorder?.(fromIndex, openTabs.length)
    }
    resetDrag()
  }

  const indicator = (
    <div key="drop-indicator" className={styles.dropIndicator} role="separator" aria-label="Drop tab here" />
  )

  const items = []
  openTabs.forEach((tab, index) => {
    if (dragId != null && overIndex === index) items.push(indicator)

    const conn     = connMap[tab.connId]
    const isActive = tab.id === activeTabId
    const isEditor = tab.type === 'editor'
    const isDirty  = dirtyTabs?.has(tab.id)
    const isDragged = tab.id === dragId
    items.push(
      <div
        key={tab.id}
        data-tabid={tab.id}
        draggable
        className={[styles.tab, isActive ? styles.tabActive : '', isDragged ? styles.tabDragging : '']
          .filter(Boolean)
          .join(' ')}
        onClick={() => onActivate(tab.id)}
        onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
        onDragStart={(e) => handleDragStart(e, tab, index)}
        onDragOver={(e) => handleTabDragOver(e, index)}
        onDrop={(e) => handleTabDrop(e, tab.id, index)}
        onDragEnd={resetDrag}
      >
        {isEditor
          ? <FileText size={12} />
          : <ConnectionIcon icon={conn?.icon ?? null} size={12} />}
        {/* `||` rather than `??`: an empty label is as good as no label,
            and a nameless tab tells the user nothing. */}
        <span>{isEditor ? tab.name : (tab.label || conn?.name || tab.connId)}</span>
        {isEditor
          ? (isDirty && <span className={styles.dirtyDot} title="Unsaved changes">●</span>)
          : <span className={styles.tabType}>{tab.type}</span>}
        <Tooltip tip="Close tab" side="top">
          <button
            className={styles.closeBtn}
            title="Close tab"
            onClick={(e) => { e.stopPropagation(); onClose(tab.id) }}
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </Tooltip>
      </div>
    )
  })
  if (dragId != null && overIndex === openTabs.length) items.push(indicator)

  return (
    <div className={styles.tabBar} onDragOver={handleContainerDragOver} onDrop={handleContainerDrop}>
      {items}
    </div>
  )
}
