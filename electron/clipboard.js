// The app's single cut/copy clipboard: a pointer to one or more remote paths
// on one connection, not the files themselves — cut and copy only record the
// reference, and the real work happens at paste time. Held once in main.js
// (a single instance shared across every tab, the way an OS clipboard is)
// and threaded into the clipboard/paste IPC handlers.
//
// A plain factory rather than module-level state so a test can hold an
// isolated store per case instead of sharing one global across the suite.
export function createClipboardStore() {
  let entry = null // { mode: 'cut' | 'copy', connectionId, paths: string[] } | null

  return {
    /** Records a fresh clipboard entry, replacing whatever was there. */
    set(mode, connectionId, paths) {
      entry = { mode, connectionId, paths: [...paths] }
    },
    /** The current entry, or null when the clipboard is empty. */
    get() {
      return entry
    },
    /** Empties the clipboard — called on a successful paste. */
    clear() {
      entry = null
    },
  }
}

// The fields that make a connection's identity, for the purpose of deciding
// whether a clipboard pointer recorded against it is still meaningful. Two
// connections with the same id but a different host/user/root do not refer
// to the same remote filesystem.
function connectionIdentity(conn) {
  if (!conn) return null
  return JSON.stringify({
    type: conn.type,
    host: conn.sftp?.host,
    port: conn.sftp?.port,
    username: conn.sftp?.username,
    remotePath: conn.sftp?.remotePath,
  })
}

// Whether a clipboard entry should be dropped because the connection it was
// recorded against was deleted or edited underneath it. A cut/copy pointer
// only means anything while the connection it points at still resolves to
// the same host/user/root — an edited or removed connection makes the
// recorded paths meaningless, and a stale clipboard entry is worse than an
// empty one.
export function shouldClearClipboardForConnectionsChange(clipboardEntry, oldConnections, newConnections) {
  if (!clipboardEntry) return false
  const newConn = (newConnections ?? []).find((c) => c.id === clipboardEntry.connectionId)
  if (!newConn) return true
  const oldConn = (oldConnections ?? []).find((c) => c.id === clipboardEntry.connectionId)
  return connectionIdentity(oldConn) !== connectionIdentity(newConn)
}
