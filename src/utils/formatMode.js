// Converts a stat "%a"-style octal mode ("755") into an rwx triplet
// ("rwxr-xr-x") for the Properties dialog's Remote attributes section.
// Returns null for anything that isn't a 3-4 digit octal mode rather than
// throwing on unexpected server output. Mirrors electron/remote-entry-info.js's
// formatMode — duplicated rather than imported so the renderer never reaches
// across the main-process boundary for a ten-line pure function.
export function formatMode(octalStr) {
  if (typeof octalStr !== 'string') return null
  const trimmed = octalStr.trim()
  if (!/^[0-7]{3,4}$/.test(trimmed)) return null
  const digits = trimmed.slice(-3).split('').map(Number)
  const bits = ['r', 'w', 'x']
  return digits
    .map((d) => bits.map((b, i) => (d & (4 >> i) ? b : '-')).join(''))
    .join('')
}
