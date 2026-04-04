/**
 * Returns true if p is a safe absolute POSIX remote path:
 *   - non-empty string
 *   - starts with /
 *   - no null bytes
 *   - no .. path segments (e.g. /../, /.., or standalone ..)
 *
 * Does NOT restrict which connection root the path belongs to —
 * all absolute paths are accepted so free navigation works.
 *
 * Callers are responsible for trimming whitespace before passing paths here.
 *
 * @param {unknown} p
 * @returns {boolean}
 */
export function validateRemotePath(p) {
  return typeof p === 'string'
    && p.startsWith('/')
    && !p.includes('\0')
    && !/(?:^|\/)\.\.(?:\/|$)/.test(p)
}
