// Global toast store. Module singleton + subscribe, mirroring services/remoteFS
// so any view or hook can raise a toast without prop-drilling or context.
// React-free and dependency-free, so it is unit-testable with fake timers.
//
// Removal is two-phase: dismiss() flips a toast to `exiting` and keeps it in the
// list for EXIT_MS so the host can play an out animation, then drops it. The
// host is therefore a pure view of the store — it owns no lifecycle state.

const EXIT_MS = 200 // grace period for the exit animation; matches toastOut in Toast.module.css

let toasts       = []          // current stack (stable ref between mutations)
const listeners  = new Set()
const timers     = new Map()   // id -> setTimeout handle (auto-dismiss, then removal)
let seq          = 0

function notify() {
  for (const fn of listeners) fn()
}

function clearTimer(id) {
  const h = timers.get(id)
  if (h !== undefined) {
    clearTimeout(h)
    timers.delete(id)
  }
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot() {
  return toasts
}

/**
 * Show a toast. Returns its id. Supplying a stable `id` replaces an existing
 * toast with that id (used for sticky notices and messages that update in
 * place) rather than stacking a duplicate; a re-show also cancels a pending
 * exit, resurrecting a toast that was animating out.
 */
export function show({ msg, type = 'info', sticky = false, duration = 4000, id } = {}) {
  const toastId = id ?? `t${++seq}`
  clearTimer(toastId)

  const entry = { id: toastId, msg, type, sticky, duration, exiting: false }
  const idx = toasts.findIndex((t) => t.id === toastId)
  toasts = idx >= 0
    ? toasts.map((t) => (t.id === toastId ? entry : t))
    : [...toasts, entry]

  if (!sticky && duration > 0) timers.set(toastId, setTimeout(() => dismiss(toastId), duration))
  notify()
  return toastId
}

/** Begin dismissing a toast: flip it to `exiting`, then remove it after EXIT_MS. */
export function dismiss(id) {
  const t = toasts.find((x) => x.id === id)
  if (!t || t.exiting) return
  clearTimer(id)
  toasts = toasts.map((x) => (x.id === id ? { ...x, exiting: true } : x))
  timers.set(id, setTimeout(() => remove(id), EXIT_MS))
  notify()
}

function remove(id) {
  clearTimer(id)
  const next = toasts.filter((t) => t.id !== id)
  if (next.length !== toasts.length) {
    toasts = next
    notify()
  }
}

/** Stop a toast's auto-dismiss timer (e.g. while hovered). No-op while exiting. */
export function pause(id) {
  const t = toasts.find((x) => x.id === id)
  if (!t || t.exiting) return
  clearTimer(id)
}

/** Restart a paused toast's auto-dismiss timer. */
export function resume(id) {
  const t = toasts.find((x) => x.id === id)
  if (t && !t.sticky && !t.exiting && t.duration > 0 && !timers.has(id)) {
    timers.set(id, setTimeout(() => dismiss(id), t.duration))
  }
}

export function clearAll() {
  for (const h of timers.values()) clearTimeout(h)
  timers.clear()
  if (toasts.length) {
    toasts = []
    notify()
  }
}
