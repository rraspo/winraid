import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import styles from './EntryMenu.module.css'

export default function EntryMenu({ isDir, isEditable, busy, onCheckout, onEdit, onMove, onDelete }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  const wrapRef    = useRef(null)
  const dropdownRef = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left, right: undefined })
    setOpen(true)
  }

  // Flip left or up if the dropdown overflows the viewport
  useLayoutEffect(() => {
    if (!open || !dropdownRef.current || !wrapRef.current) return
    const dropRect = dropdownRef.current.getBoundingClientRect()
    const btnRect  = wrapRef.current.getBoundingClientRect()
    const next = {}
    if (dropRect.right > window.innerWidth) {
      next.left  = undefined
      next.right = window.innerWidth - btnRect.right
    }
    if (dropRect.bottom > window.innerHeight) {
      next.top = btnRect.top - dropRect.height - 4
    }
    if (Object.keys(next).length > 0) setPos((prev) => ({ ...prev, ...next }))
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) setOpen(false)
    }
    function onScroll() { setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [open])

  function act(fn) {
    return (e) => { e.stopPropagation(); setOpen(false); fn() }
  }

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        className={styles.menuDotBtn}
        onClick={toggle}
        disabled={busy}
      >
        <MoreHorizontal size={14} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className={styles.menuDropdown}
          style={{ top: pos.top, left: pos.left, right: pos.right }}
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
        </div>,
        document.body
      )}
    </div>
  )
}
