// The pure decisions behind resolving a trash operation's context — pulled
// out of main.js because main.js boots the app on import and cannot be
// unit-tested directly.

/** A connection's configured trash folder, or null for none/blank. */
export function resolveTrashFolder(rawFolder) {
  return typeof rawFolder === 'string' && rawFolder.trim() ? rawFolder : null
}

/**
 * What a trash operation (list/restore/purge) gets to work with: the error
 * from resolving the connection's pooled primitives, if any; otherwise
 * { noFolder: true } when the connection has no trash folder configured, or
 * { root, deps } once one is.
 */
export function trashContextFor(base, folder) {
  if (base.error) return base
  if (!folder) return { noFolder: true }
  return { root: folder, deps: base.deps }
}
