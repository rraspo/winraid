import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.css'

/**
 * Hover tooltip rendered via portal — immune to overflow:hidden clipping.
 *
 * Props:
 *   tip         {string}           — tooltip text
 *   side        {'right'|'left'}   — which side of the anchor to open toward (default 'right')
 *   followMouse {bool}             — tracks the cursor instead of anchoring to the element
 *   children                       — the element to attach the tooltip to
 */
export default function Tooltip({ tip, side = 'right', followMouse = false, children }) {
  const [visible, setVisible] = useState(false)
  const [mouse, setMouse]     = useState({ x: 0, y: 0 })
  const anchorRef = useRef(null)
  const [anchorRect, setAnchorRect] = useState(null)

  const handleEnter = useCallback((e) => {
    if (followMouse) {
      setMouse({ x: e.clientX, y: e.clientY })
    } else {
      setAnchorRect(anchorRef.current?.getBoundingClientRect() ?? null)
    }
    setVisible(true)
  }, [followMouse])

  const handleMove = useCallback((e) => {
    if (followMouse) setMouse({ x: e.clientX, y: e.clientY })
  }, [followMouse])

  const handleLeave = useCallback(() => setVisible(false), [])

  if (!tip) return children

  let bubbleStyle
  if (followMouse) {
    bubbleStyle = { top: mouse.y + 14, left: mouse.x + 14 }
  } else if (anchorRect) {
    const midY = Math.round(anchorRect.top + anchorRect.height / 2)
    bubbleStyle = side === 'left'
      ? { top: midY, right: Math.round(window.innerWidth - anchorRect.left + 10) }
      : { top: midY, left: Math.round(anchorRect.right + 10) }
  } else {
    bubbleStyle = { display: 'none' }
  }

  return (
    <>
      <span
        ref={anchorRef}
        className={styles.anchor}
        onMouseEnter={handleEnter}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {children}
      </span>

      {visible && createPortal(
        <div
          className={[styles.bubble, followMouse ? '' : styles.bubbleStatic].join(' ')}
          style={bubbleStyle}
        >
          {tip}
        </div>,
        document.body
      )}
    </>
  )
}
