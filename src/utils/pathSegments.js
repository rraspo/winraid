// Splits a folder path into breadcrumb segments, each carrying the label to
// display and the full path it represents, from the root down to the
// folder itself.

export function buildPathSegments(dirPath) {
  const segments = [{ label: '/', path: '/' }]
  if (!dirPath || dirPath === '/') return segments
  let cumulative = ''
  for (const part of dirPath.split('/').filter(Boolean)) {
    cumulative += '/' + part
    segments.push({ label: part, path: cumulative })
  }
  return segments
}
