// Small helpers shared between the play wall and the play viewer, kept out
// of both components so neither has to duplicate them.

export function withThumb(url) {
  return url + (url.includes('?') ? '&' : '?') + 'thumb=1'
}
