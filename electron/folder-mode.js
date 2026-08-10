// Folder-mode decision helpers. Kept dependency-free so they can be unit
// tested in isolation (worker.js imports Electron main and is not importable
// under Vitest).

/**
 * Whether a successful upload should prune empty ancestor directories on the
 * local watch tree. Only mirror_clean prunes, and only when the connection has
 * not opted to keep its folder structure (keepEmptyDirs). An absent flag is
 * treated as false, preserving the original always-prune behavior.
 * @param {{ folderMode?: string, keepEmptyDirs?: boolean }} conn
 * @returns {boolean}
 */
export function shouldPruneEmptyDirs(conn) {
  return conn.folderMode === 'mirror_clean' && !conn.keepEmptyDirs
}

/**
 * Whether this connection deletes the local source file after a successful
 * upload (explicit move, or mirror_clean's copy-then-clean-local). These are
 * the flows where a name collision on the remote must never be resolved by a
 * silent skip or overwrite — the local copy is about to be destroyed.
 * @param {{ operation?: string, folderMode?: string }} conn
 * @returns {boolean}
 */
export function deletesLocalAfterUpload(conn) {
  return conn.operation === 'move' || conn.folderMode === 'mirror_clean'
}
