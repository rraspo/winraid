import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { resolveTooltipPlacement } from './tooltipPlacement'
import { isTooltipWarm, markTooltipWarm } from './tooltipWarmth'
import styles from './Tooltip.module.css'

const COLD_DELAY_MS = 600

/**
 * Hover tooltip rendered via portal — immune to overflow:hidden clipping.
 *
 * Props:
 *   tip         {string}           — tooltip text
 *   side        {'top'|'bottom'|'right'|'left'} — axis hint (default 'right').
 *                 Within the axis the bubble prefers right/bottom and only flips
 *                 to left/up when the preferred side does not fit the viewport.
 *   followMouse {bool}             — tracks the cursor instead of anchoring to the element
 *   children                       — the element to attach the tooltip to
 */
export default function Tooltip({ tip, side = 'right', followMouse = false, onlyWhenTruncated = false, children }) {
  const [visible, setVisible] = useState(false)
  const [mouse, setMouse]     = useState({ x: 0, y: 0 })
  const anchorRef = useRef(null)
  const bubbleRef = useRef(null)
  const [anchorRect, setAnchorRect] = useState(null)
  // Anchored placement, computed after the bubble mounts and is measured.
  const [placement, setPlacement] = useState(null) // null | { side, style }
  const coldTimerRef = useRef(null)
  // Tracks whether this hover actually reached "visible" — only a hover that
  // showed should hand off warmth when it closes, not one that left mid-delay.
  const shownRef = useRef(false)

  const clearColdTimer = useCallback(() => {
    if (coldTimerRef.current !== null) {
      clearTimeout(coldTimerRef.current)
      coldTimerRef.current = null
    }
  }, [])

  // No leaked timer on unmount, including mid-delay.
  useEffect(() => clearColdTimer, [clearColdTimer])

  // Resolve placement once the bubble is in the DOM so we can measure it.
  // Runs before paint, so the move from the hidden first pass is not visible.
  useLayoutEffect(() => {
    if (!visible || followMouse || !anchorRect) return
    const node = bubbleRef.current
    if (!node) return
    setPlacement(resolveTooltipPlacement({
      side,
      anchor: anchorRect,
      bubble: { width: node.offsetWidth, height: node.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))
  }, [visible, anchorRect, side, followMouse])

  const handleEnter = useCallback((e) => {
    if (onlyWhenTruncated) {
      const el = anchorRef.current
      if (el && el.scrollWidth <= el.clientWidth) return
    }
    if (followMouse) {
      setMouse({ x: e.clientX, y: e.clientY })
    } else {
      setPlacement(null) // remeasure for the new anchor position
      setAnchorRect(anchorRef.current?.getBoundingClientRect() ?? null)
    }

    clearColdTimer()
    if (isTooltipWarm()) {
      shownRef.current = true
      setVisible(true)
    } else {
      coldTimerRef.current = setTimeout(() => {
        coldTimerRef.current = null
        shownRef.current = true
        setVisible(true)
      }, COLD_DELAY_MS)
    }
  }, [followMouse, onlyWhenTruncated, clearColdTimer])

  const handleMove = useCallback((e) => {
    if (followMouse) setMouse({ x: e.clientX, y: e.clientY })
  }, [followMouse])

  const handleLeave = useCallback(() => {
    clearColdTimer()
    setVisible(false)
    if (shownRef.current) {
      markTooltipWarm()
      shownRef.current = false
    }
  }, [clearColdTimer])

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
    if (placement) {
      bubbleStyle = placement.style
      bubbleClass = (placement.side === 'left' || placement.side === 'right')
        ? [styles.bubble, styles.bubbleStatic].join(' ')
        : styles.bubble
    } else {
      // First pass before measurement — keep it laid out (for sizing) but hidden.
      bubbleStyle = { top: 0, left: 0, visibility: 'hidden' }
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
        <div ref={bubbleRef} className={bubbleClass} style={bubbleStyle}>
          {tip}
        </div>,
        document.body
      )}
    </>
  )
}
