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
