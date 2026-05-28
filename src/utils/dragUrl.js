// Extracting URLs from a DataTransfer received during a drag from a browser.
//
// When a user drags an image (or anything) out of a web page, the source
// browser fills the DataTransfer with one or more URL-flavoured types:
//
//   text/uri-list   — IETF standard, one URL per line, `#`-prefixed lines
//                     are comments.
//   text/x-moz-url  — Firefox-specific, alternating URL\nTITLE pairs.
//   text/plain      — last resort; may be a URL written as plain text.
//
// We pull URLs out of those in order of reliability, dedupe, and accept
// only http(s) — the main-process url:fetch handler refuses other schemes
// anyway, so filtering here just gives clearer behaviour upstream.

function isAcceptableUrl(s) {
  if (typeof s !== 'string') return false
  const trimmed = s.trim()
  return /^https?:\/\//i.test(trimmed)
}

export function extractDragUrls(dataTransfer) {
  if (!dataTransfer || typeof dataTransfer.getData !== 'function') return []
  const out = []
  const push = (s) => {
    const t = (s || '').trim()
    if (isAcceptableUrl(t)) out.push(t)
  }

  // text/uri-list — newline-separated, # lines are comments.
  const uriList = dataTransfer.getData('text/uri-list')
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      if (line.startsWith('#')) continue
      push(line)
    }
  }

  // text/x-moz-url — alternating URL and TITLE lines (Firefox).
  const mozUrl = dataTransfer.getData('text/x-moz-url')
  if (mozUrl) {
    const lines = mozUrl.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 2) push(lines[i])
  }

  // text/plain — last resort if the previous two yielded nothing.
  if (out.length === 0) push(dataTransfer.getData('text/plain'))

  // Dedupe preserving first-seen order.
  const seen = new Set()
  const unique = []
  for (const u of out) {
    if (!seen.has(u)) { seen.add(u); unique.push(u) }
  }
  return unique
}
