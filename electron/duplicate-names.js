// Duplicate-name resolution for the renameDuplicates connection setting.
// Kept dependency-free so it can be unit tested in isolation and shared by
// both transfer backends (SFTP and SMB). Rel paths use forward slashes — the
// SMB backend converts to backslashes after resolution.

const MAX_DUPLICATE_ATTEMPTS = 1000

/**
 * Windows-Explorer-style duplicate name: "movie.mkv" → "movie (n).mkv".
 * The counter goes before the extension (last dot of the basename); a leading
 * dot is part of the name, not an extension.
 * @param {string} relPath
 * @param {number} counter
 * @returns {string}
 */
export function duplicateName(relPath, counter) {
  const slash = relPath.lastIndexOf('/')
  const dir   = slash === -1 ? '' : relPath.slice(0, slash + 1)
  const base  = slash === -1 ? relPath : relPath.slice(slash + 1)

  const dot = base.lastIndexOf('.')
  const hasExtension = dot > 0 // dot at position 0 is a dotfile, not an extension
  const stem = hasExtension ? base.slice(0, dot) : base
  const ext  = hasExtension ? base.slice(dot) : ''

  return `${dir}${stem} (${counter})${ext}`
}

/**
 * First free "name (n).ext" variant of relPath, probing the remote through
 * the injected exists() check. The original relPath is assumed taken.
 * @param {string} relPath
 * @param {(relPath: string) => Promise<boolean>} exists
 * @returns {Promise<string>}
 */
export async function findAvailableRelPath(relPath, exists) {
  for (let counter = 1; counter <= MAX_DUPLICATE_ATTEMPTS; counter++) {
    const candidate = duplicateName(relPath, counter)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`No free duplicate name for "${relPath}" after ${MAX_DUPLICATE_ATTEMPTS} attempts`)
}
