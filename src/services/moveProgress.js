// Moves of files on the NAS that are running right now. Module singleton +
// subscribe, like services/toast, so the shell can show every move the way
// it shows transfers, whichever screen or tab started it.

let moves = []          // [{ id, connectionId, total, done, name }] (stable ref between changes)
const listeners = new Set()
let seq = 0

function notify() {
  for (const listener of listeners) listener()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot() {
  return moves
}

/** Registers a move of `total` items and returns its id. */
export function begin({ connectionId, total }) {
  const id = `m${++seq}`
  moves = [...moves, { id, connectionId, total, done: 0, name: null }]
  notify()
  return id
}

/** Records how many items are done and which one is moving now. */
export function report(id, { done, name }) {
  if (!moves.some((move) => move.id === id)) return
  moves = moves.map((move) => (move.id === id ? { ...move, done, name } : move))
  notify()
}

export function end(id) {
  if (!moves.some((move) => move.id === id)) return
  moves = moves.filter((move) => move.id !== id)
  notify()
}

/** Test helper: forgets every move. */
export function clearAll() {
  moves = []
  notify()
}
