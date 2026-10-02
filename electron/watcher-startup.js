import { watchableConnections } from './watchable.js'

// Watcher on/off intent survives a restart as a list of the connection ids the
// user explicitly stopped. Everything else auto-starts when its folder is
// present, so configs written before the list existed keep starting every
// connection. The list is main's alone: the renderer rewrites the whole
// connections array on save, which would clobber a flag stored inside it.

export function planLaunchWatchers(connections, stoppedIds, folderExists) {
  const stoppedSet = new Set(stoppedIds ?? [])
  const stopped   = []
  const remaining = []

  for (const connection of connections ?? []) {
    if (stoppedSet.has(connection?.id)) stopped.push(connection.id)
    else remaining.push(connection)
  }

  const { startable, blocked } = watchableConnections(remaining, folderExists)
  return { startable, blocked, stopped }
}

export function withWatchIntent(stoppedIds, connectionId, watching) {
  const others = (stoppedIds ?? []).filter((id) => id !== connectionId)
  return watching ? others : [...others, connectionId]
}

// One wording for a connection that could not be watched, shared by every
// path that starts watchers in bulk.
export function describeBlockedWatcher(entry) {
  const why = entry.reason === 'no-folder' ? 'no watch folder configured' : 'watch folder is missing'
  return `Watcher [${entry.id}] not started: ${why}`
}
