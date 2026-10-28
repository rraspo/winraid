export function formatSize(bytes) {
  if (!bytes) return '\u2014'
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

// One formatter for the whole app: toLocaleDateString builds a new one per
// call, and every visible Browse row formats a date on each render.
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function formatDate(ts) {
  if (!ts) return '\u2014'
  return DATE_FORMAT.format(ts)
}

// mm:ss (or h:mm:ss past an hour) \u2014 the shape a video's seek bar already
// uses, so a duration reads the same wherever it shows up.
export function formatDuration(seconds) {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return ''
  const total = Math.round(seconds)
  const hrs  = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`
}

// Named resolution bucket ("4K", "1080p", \u2026) from raw pixel dimensions \u2014
// the compact label Browse's video bar/column/Properties all show, keyed
// off the longer edge so portrait clips still bucket sensibly.
export function formatVideoResolution(width, height) {
  if (!width || !height) return ''
  const longEdge = Math.max(width, height)
  if (longEdge >= 3840) return '4K'
  if (longEdge >= 2560) return '1440p'
  if (longEdge >= 1920) return '1080p'
  if (longEdge >= 1280) return '720p'
  if (longEdge >= 854)  return '480p'
  return `${width}\u00d7${height}`
}

// Raw pixel dimensions for an image \u2014 unlike video there's no "named"
// bucket convention users expect, so this shows the real numbers.
export function formatDimensions(width, height) {
  if (!width || !height) return ''
  return `${width} \u00d7 ${height}`
}

// The single Media-column string Browse's list view shows: duration +
// resolution for a video, dimensions for an image, blank for anything
// else (or before metadata has arrived).
export function formatMediaSummary(meta) {
  if (!meta) return ''
  if (meta.kind === 'video') {
    const duration   = formatDuration(meta.duration)
    const resolution = formatVideoResolution(meta.width, meta.height)
    if (!duration && !resolution) return ''
    if (!resolution) return duration
    if (!duration) return resolution
    return `${duration} \u00b7 ${resolution}`
  }
  if (meta.kind === 'image') return formatDimensions(meta.width, meta.height)
  return ''
}
