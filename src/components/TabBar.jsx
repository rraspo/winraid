import { useState, useRef, useEffect } from 'react'
import { X, FileText } from 'lucide-react'
import ConnectionIcon from './ConnectionIcon'
import Tooltip from './ui/Tooltip'
import { getInternalDrag } from '../services/internalDrag'
import styles from './TabBar.module.css'

const DRAG_MIME = 'application/x-winraid-tab'

export default function TabBar({ openTabs, activeTabId, connections, dirtyTabs, onActivate, onClose, onReorder, onDropEntries }) {
  // `dragId` names the tab currently being dragged; `overIndex` is the array
  // slot the insertion indicator sits in front of (0..openTabs.length, the
  // same range `Array.prototype.splice` accepts). Both live only for the
  // duration of one drag gesture and never touch tab identity or order by
  // themselves — only a `drop` does that, via `onReorder`.
  const [dragId,    setDragId]    = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  // The tab files from a browse view are hovering, and the timer that
  // switches to it if they stay.
  const [entriesOverId, setEntriesOverId] = useState(null)
  const dwellTimer = useRef(null)
  useEffect(() => () => clearTimeout(dwellTimer.current), [])

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

  // Files dragged out of a browse tab can land on another browse tab of the
  // same connection — they move into the folder that tab is showing. The tab
  // in front is refused: dropping there is just a drop into the view below.
  function acceptsEntries(tab) {
    const drag = getInternalDrag()
    return drag != null
      && tab.type === 'browse'
      && tab.id !== activeTabId
      && tab.location?.connectionId === drag.connectionId
  }

  function clearEntriesHover() {
    clearTimeout(dwellTimer.current)
    dwellTimer.current = null
    setEntriesOverId(null)
  }

  // Hovering any other tab with files switches to it after a short dwell,
  // the way hovering a folder opens it, so the drop can aim at a folder
  // inside that tab instead of the tab as a whole.
  function handleEntriesDragOver(e, tab) {
    if (acceptsEntries(tab)) {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    }
    if (entriesOverId === tab.id) return
    clearTimeout(dwellTimer.current)
    setEntriesOverId(tab.id)
    dwellTimer.current = tab.id === activeTabId ? null : setTimeout(() => {
      dwellTimer.current = null
      // A drag cancelled while resting here (Esc) must not switch tabs.
      if (getInternalDrag() != null) onActivate(tab.id)
    }, 600)
  }

  function handleTabDragOver(e, index, tab) {
    e.stopPropagation()
    if (dragId == null && getInternalDrag() != null) {
      handleEntriesDragOver(e, tab)
      return
    }
    e.preventDefault()
    if (dragId == null) return
    setOverIndex(index)
  }

  function handleTabDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return
    clearEntriesHover()
  }

  function handleTabDrop(e, targetId, index) {
    e.preventDefault()
    e.stopPropagation()
    if (dragId == null && getInternalDrag() != null) {
      const tab = openTabs.find((t) => t.id === targetId)
      clearEntriesHover()
      if (tab && acceptsEntries(tab)) onDropEntries?.(targetId)
      return
    }
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
        data-drop-target={entriesOverId === tab.id && acceptsEntries(tab) ? 'true' : undefined}
        onDragOver={(e) => handleTabDragOver(e, index, tab)}
        onDragLeave={handleTabDragLeave}
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
