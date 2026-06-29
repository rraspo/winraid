import { useState, useEffect, useLayoutEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import styles from './EntryMenu.module.css'

const EntryMenu = forwardRef(function EntryMenu({
  isDir, isEditable, busy, onDownload, onEdit, onMove, onDelete,
  localCandidate = null, checkLocalExists, onRevealLocal,
}, ref) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  // Whether the local mirror copy exists — resolved lazily each time the menu
  // opens so we never stat the filesystem for rows the user never interacts with.
  const [revealOk, setRevealOk] = useState(false)
  const wrapRef    = useRef(null)
  const dropdownRef = useRef(null)
  // Tracks whether the menu was opened at a cursor position (right-click) vs
  // anchored to the dot button, which changes how overflow is corrected.
  const cursorModeRef = useRef(false)

  // Open the menu at arbitrary viewport coordinates (used for right-click).
  useImperativeHandle(ref, () => ({
    openAt(x, y) {
      cursorModeRef.current = true
      setPos({ top: y, left: x, right: undefined })
      setOpen(true)
    },
  }))

  function toggle(e) {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    cursorModeRef.current = false
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left, right: undefined })
    setOpen(true)
  }

  // Correct for viewport overflow once the dropdown has measured itself.
  useLayoutEffect(() => {
    if (!open || !dropdownRef.current) return
    const dropRect = dropdownRef.current.getBoundingClientRect()
    if (cursorModeRef.current) {
      // Cursor-anchored: clamp the menu inside the viewport.
      const next = {}
      if (dropRect.right > window.innerWidth)  next.left = window.innerWidth - dropRect.width - 8
      if (dropRect.bottom > window.innerHeight) next.top  = window.innerHeight - dropRect.height - 8
      if (Object.keys(next).length > 0) setPos((prev) => ({ ...prev, ...next }))
      return
    }
    // Button-anchored: flip left/up off the button.
    if (!wrapRef.current) return
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
  }, [open, revealOk])

  // Resolve local-mirror existence when the menu opens. The reset lives in the
  // cleanup (which React runs before the next open and on close) so the effect
  // body never calls setState synchronously.
  useEffect(() => {
    if (!open || !localCandidate || !checkLocalExists) return undefined
    let cancelled = false
    // Guard the boundary: checkLocalExists crosses to IPC, which can be absent
    // (preload/renderer version skew) — a throw here must not crash the tree.
    Promise.resolve()
      .then(() => checkLocalExists(localCandidate))
      .then((ok) => { if (!cancelled) setRevealOk(!!ok) })
      .catch(() => { if (!cancelled) setRevealOk(false) })
    return () => { cancelled = true; setRevealOk(false) }
  }, [open, localCandidate, checkLocalExists])

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
          <button className={styles.menuItem} onClick={act(onDownload)}>
            Download
          </button>
          {isEditable && (
            <button className={styles.menuItem} onClick={act(onEdit)}>
              Edit
            </button>
          )}
          <button className={styles.menuItem} onClick={act(onMove)}>
            Move / Rename
          </button>
          {revealOk && (
            <button className={styles.menuItem} onClick={act(() => onRevealLocal(localCandidate))}>
              Reveal in Explorer
            </button>
          )}
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
})

export default EntryMenu
