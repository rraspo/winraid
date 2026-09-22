import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SegmentedControl from '../ui/SegmentedControl'
import entryMenuStyles from './EntryMenu.module.css'
import styles from './OptionsPopover.module.css'

// Per-view Browse preferences, anchored to the overflow button — reuses the
// same portal + button-anchored viewport-flip positioning EntryMenu.jsx's
// dropdown already implements (minus the cursor-anchored branch, which only
// applies to a right-click menu; Options never opens that way).
export default function OptionsPopover({
  anchorRef, open, onClose,
  browseOptions, onSetThumbnails, onSetColumn, onSetDensity, onSetShowHidden,
  sortPersistence, onSetSortPersistence,
  onOpenSettings,
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, right: undefined })
  const dropdownRef = useRef(null)

  useLayoutEffect(() => {
    if (!open) return
    const btnRect = anchorRef?.current?.getBoundingClientRect()
    if (btnRect) setPos({ top: btnRect.bottom + 4, left: btnRect.left, right: undefined })
  }, [open, anchorRef])

  // Correct for viewport overflow once the popover has measured itself —
  // flip left/up off the anchor button, the same rule EntryMenu's own
  // button-anchored branch applies.
  useLayoutEffect(() => {
    if (!open || !dropdownRef.current || !anchorRef?.current) return
    const dropRect = dropdownRef.current.getBoundingClientRect()
    const btnRect  = anchorRef.current.getBoundingClientRect()
    const next = {}
    if (dropRect.right > window.innerWidth) {
      next.left  = undefined
      next.right = window.innerWidth - btnRect.right
    }
    if (dropRect.bottom > window.innerHeight) {
      next.top = btnRect.top - dropRect.height - 4
    }
    if (Object.keys(next).length > 0) setPos((prev) => ({ ...prev, ...next }))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- anchorRef is a ref

  useEffect(() => {
    if (!open) return undefined
    function onDown(e) {
      if (dropdownRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={dropdownRef}
      role="menu"
      aria-label="Browse options"
      className={styles.popover}
      style={{ top: pos.top, left: pos.left, right: pos.right }}
    >
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={browseOptions.thumbnails}
          onChange={(e) => onSetThumbnails(e.target.checked)}
        />
        Thumbnails
      </label>

      <div className={styles.sectionLabel}>Columns</div>
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={browseOptions.columns.size}
          onChange={(e) => onSetColumn('size', e.target.checked)}
        />
        Size
      </label>
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={browseOptions.columns.modified}
          onChange={(e) => onSetColumn('modified', e.target.checked)}
        />
        Modified
      </label>
      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={browseOptions.columns.kind}
          onChange={(e) => onSetColumn('kind', e.target.checked)}
        />
        Kind
      </label>

      <SegmentedControl
        label="Density"
        value={browseOptions.density}
        onChange={onSetDensity}
        options={[
          { value: 'compact', label: 'Compact' },
          { value: 'default', label: 'Default' },
          { value: 'roomy',   label: 'Roomy' },
        ]}
      />

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={browseOptions.showHidden}
          onChange={(e) => onSetShowHidden(e.target.checked)}
        />
        Show hidden files
      </label>

      <SegmentedControl
        label="Remember this sort for"
        value={sortPersistence}
        onChange={onSetSortPersistence}
        options={[
          { value: 'folder',     label: 'This folder' },
          { value: 'connection', label: 'This connection' },
          { value: 'default',    label: 'Everywhere' },
        ]}
      />

      <div className={entryMenuStyles.menuDivider} />
      <button type="button" role="menuitem" className={entryMenuStyles.menuItem} onClick={onOpenSettings}>
        All settings…
      </button>
    </div>,
    document.body,
  )
}
