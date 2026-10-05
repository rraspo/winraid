import { posix } from 'path'

// A remote delete moves the item into a folder on the same share instead of
// unlinking it. Dot-prefixed so every listing that already hides dot-names
// hides the trash with no extra rule.
export const TRASH_DIR = '.winraid-trash'

// Each entry directory carries one of these next to the moved item. One per
// entry rather than one for the whole trash: a single rewritten manifest is one
// corrupt or raced write away from losing every record at once.
export const TRASH_META = 'meta.json'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RESTORE_ATTEMPTS = 1000

function normaliseRoot(root) {
  return String(root).replace(/\/+$/, '') || '/'
}

/** Absolute path of a connection's trash folder. */
export function trashRoot(root) {
  return posix.join(normaliseRoot(root), TRASH_DIR)
}

/**
 * True for exactly one harmless path segment. Entry ids arrive from the
 * renderer and names arrive from a manifest anyone with write access to the
 * share can edit, so both are checked before they are joined onto a path.
 */
export function isPathSegment(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 &&
    value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') &&
    // eslint-disable-next-line no-control-regex -- control characters never belong in a path segment
    !/[\x00-\x1f\x7f]/.test(value)
}

/** Absolute path of one entry's own directory inside the trash. */
export function entryDir(root, id) {
  if (!isPathSegment(id)) throw new Error('Invalid trash entry')
  return posix.join(trashRoot(root), id)
}

/** Where `path` goes when it is deleted: its own directory, its own name kept. */
export function trashDestination(root, path, id) {
  const rootNorm = normaliseRoot(root)
  const target = String(path).replace(/\/+$/, '') || '/'
  if (target.split('/').includes(TRASH_DIR)) {
    throw new Error('That item is already in the trash')
  }
  if (target === '/' || target === rootNorm || rootNorm.startsWith(`${target}/`)) {
    throw new Error('The connection folder itself cannot be moved to the trash')
  }
  return posix.join(entryDir(rootNorm, id), posix.basename(target))
}

/**
 * Where a trashed entry comes back to. `opts.exists` is either a boolean for
 * "the original path is taken" or a predicate over candidate paths; a taken
 * path is never returned, so a restore cannot overwrite what took its place.
 */
export function restoreDestination(entry, opts = {}) {
  const original = entry.originalPath
  const { exists } = opts
  const isTaken = typeof exists === 'function'
    ? exists
    : (candidate) => exists === true && candidate === original
  if (!isTaken(original)) return original

  const dir = posix.dirname(original)
  const name = posix.basename(original)
  // A folder named "my.album" has no extension to preserve.
  const ext = entry.isDir ? '' : posix.extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name

  for (let attempt = 1; attempt <= MAX_RESTORE_ATTEMPTS; attempt++) {
    const suffix = attempt === 1 ? ' (restored)' : ` (restored ${attempt})`
    const candidate = posix.join(dir, `${stem}${suffix}${ext}`)
    if (!isTaken(candidate)) return candidate
  }
  throw new Error('Could not find a free name to restore to')
}

/** Entries deleted at least `maxAgeDays` ago; a limit of 0 keeps everything. */
export function expiredEntries(entries, { now, maxAgeDays }) {
  if (!(maxAgeDays > 0)) return []
  const cutoff = now - (maxAgeDays * DAY_MS)
  return entries.filter((entry) => typeof entry.deletedAt === 'number' && entry.deletedAt <= cutoff)
}

/** Total bytes the trash is holding. */
export function trashSize(entries) {
  return entries.reduce((total, entry) => total + (Number(entry.size) || 0), 0)
}
