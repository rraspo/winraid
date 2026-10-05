// Which connections can have a watcher running, decided from the connections
// themselves rather than from what happened to be running earlier.
//
// "Resume all" used to restart only the set captured when "Pause all" was
// pressed, so a connection that was stopped at that moment could never be
// started by it again, and resuming without a prior pause started nothing.
//
// A connection that cannot be watched comes back with a reason so the caller
// can say so, instead of dropping it silently.
export function watchableConnections(connections, folderExists) {
  const startable = []
  const blocked   = []

  for (const connection of connections ?? []) {
    if (!connection?.localFolder) {
      blocked.push({ id: connection.id, name: connection.name, reason: 'no-folder' })
      continue
    }
    let present = false
    try {
      present = folderExists(connection.localFolder) === true
    } catch {
      present = false
    }
    if (present) startable.push(connection)
    else blocked.push({ id: connection.id, name: connection.name, reason: 'folder-missing' })
  }

  return { startable, blocked }
}
