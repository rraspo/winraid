import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.css'

const MARGIN = 8 // min gap from viewport edges

/**
 * Hover tooltip rendered via portal — immune to overflow:hidden clipping.
 *
 * Props:
 *   tip         {string}           — tooltip text
 *   side        {'top'|'bottom'|'right'|'left'} — preferred side (default 'right')
 *   followMouse {bool}             — tracks the cursor instead of anchoring to the element
 *   children                       — the element to attach the tooltip to
 */
export default function Tooltip({ tip, side = 'right', followMouse = false, onlyWhenTruncated = false, children }) {
  const [visible, setVisible] = useState(false)
  const [mouse, setMouse]     = useState({ x: 0, y: 0 })
  const anchorRef = useRef(null)
  const [anchorRect, setAnchorRect] = useState(null)

  // Measure the bubble after mount and clamp it within the viewport
  const clampRef = useCallback((node) => {
    if (!node) return
    const rect = node.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Horizontal clamp — only adjust left, never introduce width constraints
    if (rect.right > vw - MARGIN) {
      node.style.left = `${Math.max(MARGIN, vw - rect.width - MARGIN)}px`
      node.style.right = 'auto'
    }
    if (rect.left < MARGIN) {
      node.style.left = `${MARGIN}px`
      node.style.right = 'auto'
    }

    // Vertical clamp
    if (rect.bottom > vh - MARGIN) {
      node.style.top = `${Math.max(MARGIN, vh - rect.height - MARGIN)}px`
    }
    if (rect.top < MARGIN) {
      node.style.top = `${MARGIN}px`
    }
  }, [])

  const handleEnter = useCallback((e) => {
    if (onlyWhenTruncated) {
      const el = anchorRef.current
      if (el && el.scrollWidth <= el.clientWidth) return
    }
    if (followMouse) {
      setMouse({ x: e.clientX, y: e.clientY })
    } else {
      setAnchorRect(anchorRef.current?.getBoundingClientRect() ?? null)
    }
    setVisible(true)
  }, [followMouse, onlyWhenTruncated])

  const handleMove = useCallback((e) => {
    if (followMouse) setMouse({ x: e.clientX, y: e.clientY })
  }, [followMouse])

  const handleLeave = useCallback(() => setVisible(false), [])

  if (!tip) return children

  let bubbleStyle
  let bubbleClass = styles.bubble
  if (followMouse) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const onRight = mouse.x > vw / 2
    const onBottom = mouse.y > vh * 0.75
    bubbleStyle = {
      ...(onBottom ? { bottom: Math.round(vh - mouse.y + 14) } : { top: mouse.y + 14 }),
      ...(onRight  ? { right:  Math.round(vw - mouse.x + 14) } : { left: mouse.x + 14 }),
    }
  } else if (anchorRect) {
    const midX = Math.round(anchorRect.left + anchorRect.width / 2)
    const midY = Math.round(anchorRect.top + anchorRect.height / 2)
    const vw = window.innerWidth
    const anchorOnRight = midX > vw / 2

    if (side === 'top') {
      const hPos = anchorOnRight
        ? { right: Math.round(vw - anchorRect.right) }
        : { left: Math.round(anchorRect.left) }
      bubbleStyle = { bottom: Math.round(window.innerHeight - anchorRect.top + 8), ...hPos }
      bubbleClass = styles.bubble
    } else if (side === 'bottom') {
      const hPos = anchorOnRight
        ? { right: Math.round(vw - anchorRect.right) }
        : { left: Math.round(anchorRect.left) }
      bubbleStyle = { top: Math.round(anchorRect.bottom + 8), ...hPos }
      bubbleClass = styles.bubble
    } else {
      bubbleStyle = side === 'left'
        ? { top: midY, right: Math.round(window.innerWidth - anchorRect.left + 10) }
        : { top: midY, left: Math.round(anchorRect.right + 10) }
      bubbleClass = [styles.bubble, styles.bubbleStatic].join(' ')
    }
  } else {
    bubbleStyle = { display: 'none' }
  }

  return (
    <>
      <span
        ref={anchorRef}
        className={styles.anchor}
        style={onlyWhenTruncated ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } : undefined}
        onMouseEnter={handleEnter}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {children}
      </span>

      {visible && createPortal(
        <div ref={clampRef} className={bubbleClass} style={bubbleStyle}>
          {tip}
        </div>,
        document.body
      )}
    </>
  )
}
