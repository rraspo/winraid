// Small helpers shared between the play wall and the play viewer, kept out
// of both components so neither has to duplicate them.

export function withThumb(url) {
  return url + (url.includes('?') ? '&' : '?') + 'thumb=1'
}

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
