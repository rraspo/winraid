// Mouse-position panning math for the QuickLook overlay.
// Higher gain = the mouse reaches the image edges with less travel,
// so the cursor stays in the central portion of the viewport.
export const PAN_GAIN = 1.8

export function computePan({
  offsetX, offsetY,
  viewportW, viewportH,
  mediaW, mediaH,
  zoom, invertPan,
  gain = PAN_GAIN,
}) {
  if (zoom <= 1) return { x: 0, y: 0 }
  const sign = invertPan ? 1 : -1
  let x = sign * offsetX * (zoom - 1) * gain
  let y = sign * offsetY * (zoom - 1) * gain
  const maxX = Math.max(0, (mediaW * zoom - viewportW) / 2)
  const maxY = Math.max(0, (mediaH * zoom - viewportH) / 2)
  x = Math.max(-maxX, Math.min(maxX, x))
  y = Math.max(-maxY, Math.min(maxY, y))
  // Normalise -0 to 0 so equality checks behave intuitively.
  return { x: x + 0, y: y + 0 }
}
