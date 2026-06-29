// Pure placement math for Tooltip. Kept dependency-free so it can be unit
// tested without a real layout engine (happy-dom does not compute offset sizes).
//
// `side` selects the AXIS only: 'left'/'right' -> horizontal, 'top'/'bottom' ->
// vertical. Within the axis the bubble prefers the right (horizontal) or bottom
// (vertical) side and only flips to left/up when the preferred side does not
// fit the viewport but the opposite side does.

const GAP = 10      // distance between anchor and bubble
const MARGIN = 8    // min gap from viewport edges

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/**
 * @param {object}  p
 * @param {string}  p.side     requested side (axis hint)
 * @param {{left,top,right,bottom,width,height}} p.anchor
 * @param {{width,height}}     p.bubble
 * @param {{width,height}}     p.viewport
 * @param {number} [p.gap]
 * @param {number} [p.margin]
 * @returns {{ side: 'top'|'bottom'|'left'|'right', style: object }}
 */
export function resolveTooltipPlacement({ side, anchor, bubble, viewport, gap = GAP, margin = MARGIN }) {
  const vw = viewport.width
  const vh = viewport.height
  const vertical = side === 'top' || side === 'bottom'

  if (vertical) {
    const fitsBelow = anchor.bottom + gap + bubble.height <= vh - margin
    const fitsAbove = anchor.top - gap - bubble.height >= margin
    const resolved = !fitsBelow && fitsAbove ? 'top' : 'bottom'

    // Horizontal alignment: align the bubble to the anchor's nearer edge, then
    // clamp so it stays on screen.
    const anchorOnRight = anchor.left + anchor.width / 2 > vw / 2
    const style = {}
    if (resolved === 'top') style.bottom = Math.round(vh - anchor.top + gap)
    else style.top = Math.round(anchor.bottom + gap)

    let left = anchorOnRight ? Math.round(anchor.right - bubble.width) : Math.round(anchor.left)
    left = clamp(left, margin, Math.max(margin, vw - bubble.width - margin))
    style.left = left
    return { side: resolved, style }
  }

  const fitsRight = anchor.right + gap + bubble.width <= vw - margin
  const fitsLeft = anchor.left - gap - bubble.width >= margin
  const resolved = !fitsRight && fitsLeft ? 'left' : 'right'

  const style = {}
  if (resolved === 'left') style.right = Math.round(vw - anchor.left + gap)
  else style.left = Math.round(anchor.right + gap)

  // Vertically centered on the anchor (bubble uses translateY(-50%)); clamp the
  // center so the bubble does not run off the top or bottom edge.
  const midY = anchor.top + anchor.height / 2
  const half = bubble.height / 2
  style.top = Math.round(clamp(midY, margin + half, Math.max(margin + half, vh - margin - half)))
  return { side: resolved, style }
}
