import { useState, useEffect, useRef } from 'react'
import { MoreHorizontal } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import styles from './EntryMenu.module.css'

export default function EntryMenu({ isDir, isEditable, busy, onCheckout, onEdit, onMove, onDelete }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, right: 0 })
  const wrapRef    = useRef(null)
  const dropdownRef = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right, bottom: null })
    setOpen(true)
  }

  // Flip above the button if the dropdown overflows the viewport
  useEffect(() => {
    if (!open || !dropdownRef.current || !wrapRef.current) return
    const dropRect = dropdownRef.current.getBoundingClientRect()
    if (dropRect.bottom > window.innerHeight) {
      const btnRect = wrapRef.current.getBoundingClientRect()
      setPos((prev) => ({ ...prev, top: btnRect.top - dropRect.height - 4, bottom: null }))
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function act(fn) {
    return (e) => { e.stopPropagation(); setOpen(false); fn() }
  }

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <Tooltip tip="Actions" side="bottom">
        <button
          className={styles.menuDotBtn}
          onClick={toggle}
          disabled={busy}
        >
          <MoreHorizontal size={14} />
        </button>
      </Tooltip>

      {open && (
        <div
          ref={dropdownRef}
          className={styles.menuDropdown}
          style={{ top: pos.top ?? undefined, bottom: pos.bottom ?? undefined, right: pos.right }}
        >
          {isDir && (
            <button className={styles.menuItem} onClick={act(onCheckout)}>
              Check out
            </button>
          )}
          {isEditable && (
            <button className={styles.menuItem} onClick={act(onEdit)}>
              Edit
            </button>
          )}
          <button className={styles.menuItem} onClick={act(onMove)}>
            Move / Rename
          </button>
          <div className={styles.menuDivider} />
          <button
            className={[styles.menuItem, styles.menuItemDanger].join(' ')}
            onClick={act(onDelete)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
