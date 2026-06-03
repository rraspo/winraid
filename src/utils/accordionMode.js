// Sidebar connection-accordion startup behaviour.
//   'expanded'  — all connections open on launch
//   'collapsed' — all closed on launch
//   'remember'  — restore each connection's last open/closed state
//
// Legacy: the boolean key 'sidebar-accordions-default-open' ('true'/'false')
// is migrated to 'expanded'/'collapsed' when the new key is absent.

export const ACC_MODE_KEY  = 'sidebar-accordions-mode'
export const ACC_STATE_KEY = 'sidebar-accordions-expanded'
const LEGACY_KEY = 'sidebar-accordions-default-open'

const VALID = new Set(['expanded', 'collapsed', 'remember'])

export function readAccordionMode() {
  const m = localStorage.getItem(ACC_MODE_KEY)
  if (VALID.has(m)) return m
  return localStorage.getItem(LEGACY_KEY) === 'false' ? 'collapsed' : 'expanded'
}

export function setAccordionMode(mode) {
  localStorage.setItem(ACC_MODE_KEY, mode)
}

export function readExpandedConns() {
  try {
    const arr = JSON.parse(localStorage.getItem(ACC_STATE_KEY))
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export function writeExpandedConns(idSet) {
  localStorage.setItem(ACC_STATE_KEY, JSON.stringify([...idSet]))
}

// Resolve the initial open set for a list of connection ids, given the mode
// and any previously-saved set (used only in 'remember' mode, where stale ids
// that no longer exist are dropped).
export function initialExpanded(mode, connectionIds, savedSet) {
  if (mode === 'collapsed') return new Set()
  if (mode === 'remember') {
    const valid = new Set(connectionIds)
    return new Set([...savedSet].filter((id) => valid.has(id)))
  }
  return new Set(connectionIds) // expanded (default)
}
