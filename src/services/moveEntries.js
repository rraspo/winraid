import * as moveProgress from './moveProgress'
import * as remoteFS from './remoteFS'

function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

function parentOf(entryPath) {
  return entryPath.slice(0, entryPath.lastIndexOf('/')) || '/'
}

// The entries a drop into `targetDirPath` would actually move: none when the
// target is one of the entries (or inside one), and never one that already
// lives there — dropping a file back onto its own folder is a no-op.
export function movableEntries(entries, targetDirPath) {
  const isInvalidTarget = entries.some(
    (item) => targetDirPath === item.entryPath || targetDirPath.startsWith(item.entryPath + '/'),
  )
  if (isInvalidTarget) return []
  return entries.filter((item) => joinRemote(targetDirPath, item.name) !== item.entryPath)
}

// Moves dragged entries into `targetDirPath` on one connection. Returns the
// { ok, msg } status to show, or null when the drop moves nothing. The move
// shows in the shell while it runs; `onProgress({ done, total, name })`
// also hears each item, for a caller that shows it in place.
export async function moveEntries(connectionId, entries, targetDirPath, { onProgress } = {}) {
  const itemsToMove = movableEntries(entries, targetDirPath)
  if (itemsToMove.length === 0) return null

  const total = itemsToMove.length
  const progressId = moveProgress.begin({ connectionId, total })
  let failMsg = null
  try {
    for (let index = 0; index < total; index++) {
      const item = itemsToMove[index]
      moveProgress.report(progressId, { done: index, name: item.name })
      onProgress?.({ done: index, total, name: item.name })
      const res = await window.winraid?.remote.move(connectionId, item.entryPath, joinRemote(targetDirPath, item.name))
      if (!res?.ok && failMsg === null) failMsg = res?.error || 'Move failed'
    }
  } finally {
    moveProgress.end(progressId)
    const folders = new Set([targetDirPath, ...itemsToMove.map((item) => parentOf(item.entryPath))])
    remoteFS.foldersChanged(connectionId, [...folders])
  }

  if (failMsg !== null) return { ok: false, msg: failMsg }
  const label = itemsToMove.length > 1 ? `${itemsToMove.length} items` : itemsToMove[0].name
  return { ok: true, msg: `Moved ${label}` }
}
