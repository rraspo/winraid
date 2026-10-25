import { readFileSync, writeFileSync, renameSync } from 'fs'

// Structured activity stream — a typed feed of user-facing operations
// (uploads, moves, deletes, …) surfaced on the Activity screen and the
// Dashboard. Separate from logger.js: logs stay raw text; activity is
// structured and clickable. Persisted to a JSON file in userData so the
// history survives restarts the way the transfer queue does, until the user
// clears it. Mirrors logger's injected-sender pattern to avoid a circular
// import with main.js, and takes the file path instead of importing
// electron so it stays testable in plain node.

export const ACTIVITY_CAP = 500

let _send  = null
let _file  = null
let _buf   = []   // most-recent LAST internally; tail reverses
let _seq   = 0

function load() {
  let entries = []
  try {
    const raw = JSON.parse(readFileSync(_file, 'utf8'))
    if (Array.isArray(raw?.entries)) entries = raw.entries
  } catch {
    // File doesn't exist yet or is corrupt — start fresh
  }
  _buf = entries.slice(-ACTIVITY_CAP)
  // Ids must keep climbing past whatever the previous run handed out, or a
  // new entry could share a React key with one read back from disk.
  _seq = _buf.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0)
}

// Atomic write: write to .tmp then rename over the real file.
function _persistNow() {
  if (!_file) return
  const tmp = `${_file}.tmp`
  writeFileSync(tmp, JSON.stringify({ entries: _buf }), 'utf8')
  renameSync(tmp, _file)
}

// Coalesce bursts (a bulk move records one entry per item) into one write.
const PERSIST_DEBOUNCE_MS = 200
let _persistTimer = null

function persist() {
  if (!_file) return
  if (_persistTimer !== null) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    _persistNow()
  }, PERSIST_DEBOUNCE_MS)
}

/**
 * Called once from main.js after the BrowserWindow is created. With a
 * `filePath`, loads the history recorded by earlier runs and keeps the file
 * current from here on.
 */
export function initActivity(sendFn, { filePath = null } = {}) {
  _send = sendFn
  if (_persistTimer !== null) clearTimeout(_persistTimer)
  _persistTimer = null
  _file = filePath
  if (_file) load()
}

/** Writes any pending change now — called on quit so nothing is lost. */
export function flushActivity() {
  if (_persistTimer === null) return
  clearTimeout(_persistTimer)
  _persistTimer = null
  _persistNow()
}

/**
 * Append an activity entry. Stamps id + ts, caps the buffer, pushes to the
 * renderer, and returns the stamped entry.
 */
export function pushActivity(entry) {
  const stamped = { ...entry, id: ++_seq, ts: Date.now() }
  _buf.push(stamped)
  if (_buf.length > ACTIVITY_CAP) _buf = _buf.slice(_buf.length - ACTIVITY_CAP)
  persist()
  _send?.('activity:entry', stamped)
  return stamped
}

/** Most-recent-first list of up to `n` entries. */
export function tailActivity(n = ACTIVITY_CAP) {
  return _buf.slice(-n).reverse()
}

export function clearActivity() {
  _buf = []
  persist()
}
