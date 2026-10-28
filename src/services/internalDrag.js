// The entries currently being dragged out of a browse view, shared across
// every view. Each browse tab owns its own drag-and-drop hook, but a drag can
// start in one tab and end in another (or on another tab's header), and the
// DataTransfer cannot be read until the drop — so dragover in the receiving
// view has nothing to decide on without this. There is only ever one drag at
// a time, so a module singleton is the whole story.

let current = null   // { connectionId, entries: [{ name, entryPath, ... }] } | null

export function setInternalDrag(payload) {
  current = payload
}

export function getInternalDrag() {
  return current
}

export function clearInternalDrag() {
  current = null
}
