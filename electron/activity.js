// Structured activity stream — a typed, in-memory feed of user-facing operations
// (uploads, moves, deletes, …) surfaced in the Header activity panel. Separate
// from logger.js: logs stay raw + durable on disk; activity is structured and
// session-scoped. Mirrors logger's injected-sender pattern to avoid a circular
// import with main.js.

export const ACTIVITY_CAP = 100

let _send  = null
let _buf   = []   // most-recent LAST internally; tail reverses
let _seq   = 0

/** Called once from main.js after the BrowserWindow is created. */
export function initActivity(sendFn) {
  _send = sendFn
}

/**
 * Append an activity entry. Stamps id + ts, caps the buffer, pushes to the
 * renderer, and returns the stamped entry.
 */
export function pushActivity(entry) {
  const stamped = { ...entry, id: ++_seq, ts: Date.now() }
  _buf.push(stamped)
  if (_buf.length > ACTIVITY_CAP) _buf = _buf.slice(_buf.length - ACTIVITY_CAP)
  _send?.('activity:entry', stamped)
  return stamped
}

/** Most-recent-first list of up to `n` entries. */
export function tailActivity(n = ACTIVITY_CAP) {
  return _buf.slice(-n).reverse()
}

export function clearActivity() {
  _buf = []
}
