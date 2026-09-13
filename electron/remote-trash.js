import { posix } from 'path'
import { sftpRmRf } from './sftp-helpers.js'
import { shQuote } from './shell-quote.js'
import { validateRemotePath } from './validation.js'
import {
  TRASH_META, trashRoot, entryDir, trashDestination, restoreDestination, isPathSegment,
} from './trash.js'

// Performing trash operations over a pooled SFTP connection. The decisions of
// where things go live in trash.js; this module only carries them out.
//
// `deps` is { sftp, exec, move, newId, now, warn }:
//   exec(cmd)       -> { code, stdout }, or null when the shell refuses exec
//   move(src, dst)  -> { ok, error } — the app's single remote move

// ssh2's SFTP status for a path that does not exist.
const NO_SUCH_FILE = 2

const isDirMode = (attrs) => ((attrs?.mode ?? 0) & 0o170000) === 0o040000

function call(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (err, value) => (err ? reject(err) : resolve(value)))
  })
}

async function ensureDir(sftp, path) {
  try {
    await call(sftp, 'stat', path)
    return
  } catch (err) {
    if (err.code !== NO_SUCH_FILE) throw err
  }
  const parent = posix.dirname(path)
  if (parent !== path) await ensureDir(sftp, parent)
  await call(sftp, 'mkdir', path)
}

// A file is sized by stat; a directory by `du -sb` over the same exec path the
// move uses. 0 when neither answers — a missing size never blocks a delete.
async function measureSize({ sftp, exec }, path, isDir) {
  try {
    if (!isDir) return (await call(sftp, 'stat', path)).size ?? 0
    if (!exec) return 0
    const { code, stdout } = await exec(`du -sb -- ${shQuote(path)}`)
    const match = code === 0 ? /^(\d+)/.exec(String(stdout).trim()) : null
    return match ? Number(match[1]) : 0
  } catch {
    return 0
  }
}

async function readManifest(sftp, dir, id) {
  let parsed
  try {
    parsed = JSON.parse(await call(sftp, 'readFile', posix.join(dir, TRASH_META), 'utf8'))
  } catch {
    return null
  }
  const { originalPath, name, deletedAt, size, isDir } = parsed ?? {}
  const wellFormed = validateRemotePath(originalPath) &&
    isPathSegment(name) && posix.basename(originalPath) === name &&
    Number.isFinite(deletedAt)
  if (!wellFormed) return null
  // The directory name is the id; a manifest cannot redirect an entry elsewhere.
  return { id, originalPath, name, deletedAt, size: Number(size) || 0, isDir: Boolean(isDir), restorable: true }
}

// An entry with no readable manifest still lists — named after what it holds —
// so it can be deleted permanently rather than silently occupying space.
async function describeUnrecorded(sftp, dir, id, attrs) {
  let children = []
  try {
    children = (await call(sftp, 'readdir', dir))
      .filter((child) => child.filename !== TRASH_META && isPathSegment(child.filename))
  } catch { /* unreadable entry directory: still listed, by its id */ }
  const payload = children[0]
  const payloadIsDir = payload ? isDirMode(payload.attrs) : false
  return {
    id,
    originalPath: null,
    name: payload?.filename ?? id,
    deletedAt: attrs?.mtime ? attrs.mtime * 1000 : null,
    size: payload && !payloadIsDir ? (payload.attrs?.size ?? 0) : 0,
    isDir: payloadIsDir,
    restorable: false,
  }
}

/** Move a remote file or directory into its own trash entry and record it. */
export async function moveToTrash(deps, root, remotePath, isDir) {
  const { sftp, move, newId, now, warn } = deps
  const originalPath = remotePath.replace(/\/+$/, '') || '/'
  const trashPath = trashDestination(root, originalPath, newId())
  const dir = posix.dirname(trashPath)
  const id = posix.basename(dir)

  const size = await measureSize(deps, originalPath, isDir)
  await ensureDir(sftp, dir)

  const moved = await move(originalPath, trashPath)
  if (!moved.ok) {
    await call(sftp, 'rmdir', dir).catch((err) => warn(`Could not remove empty trash entry ${dir}: ${err.message}`))
    throw new Error(moved.error)
  }

  const entry = { id, originalPath, name: posix.basename(trashPath), deletedAt: now(), size, isDir: Boolean(isDir) }
  try {
    await call(sftp, 'writeFile', posix.join(dir, TRASH_META), JSON.stringify(entry, null, 2))
  } catch (err) {
    // The item is safely in the trash either way; without its record it lists
    // as not restorable instead of being lost.
    warn(`Moved to trash but could not write its record (${err.message}): ${trashPath}`)
  }
  return { entry, trashPath }
}

/** Every entry in the connection's trash, newest first. */
export async function listTrash({ sftp }, root) {
  const base = trashRoot(root)
  let items
  try {
    items = await call(sftp, 'readdir', base)
  } catch (err) {
    if (err.code === NO_SUCH_FILE) return []
    throw err
  }
  const entries = []
  for (const item of items) {
    if (!isDirMode(item.attrs) || !isPathSegment(item.filename)) continue
    const dir = posix.join(base, item.filename)
    entries.push(await readManifest(sftp, dir, item.filename) ?? await describeUnrecorded(sftp, dir, item.filename, item.attrs))
  }
  return entries.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

/** Move an entry back, onto a renamed path if its original name is taken. */
export async function restoreFromTrash(deps, root, id) {
  const { sftp, move, warn } = deps
  const dir = entryDir(root, id)
  const entry = await readManifest(sftp, dir, id)
  if (!entry) {
    throw new Error('This item cannot be restored because its trash record is missing or unreadable. It can still be deleted permanently.')
  }

  const parent = posix.dirname(entry.originalPath)
  const taken = new Set()
  try {
    for (const child of await call(sftp, 'readdir', parent)) taken.add(posix.join(parent, child.filename))
  } catch (err) {
    if (err.code !== NO_SUCH_FILE) throw err
    await ensureDir(sftp, parent)
  }

  const restoredPath = restoreDestination(entry, { exists: (candidate) => taken.has(candidate) })
  const moved = await move(posix.join(dir, entry.name), restoredPath)
  if (!moved.ok) throw new Error(moved.error)

  try {
    await call(sftp, 'unlink', posix.join(dir, TRASH_META))
    await call(sftp, 'rmdir', dir)
  } catch (err) {
    warn(`Restored ${restoredPath} but could not clear its trash entry ${dir}: ${err.message}`)
  }
  return { restoredPath, renamed: restoredPath !== entry.originalPath }
}

/** Permanently delete one entry, or everything in the trash when no id is given. */
export async function purgeTrash({ sftp }, root, id) {
  if (id !== undefined && id !== null) {
    await sftpRmRf(sftp, entryDir(root, id))
    return { purged: 1, errors: [] }
  }

  const base = trashRoot(root)
  let items
  try {
    items = await call(sftp, 'readdir', base)
  } catch (err) {
    if (err.code === NO_SUCH_FILE) return { purged: 0, errors: [] }
    throw err
  }
  let purged = 0
  const errors = []
  for (const item of items) {
    if (!isPathSegment(item.filename)) continue
    const path = posix.join(base, item.filename)
    try {
      if (isDirMode(item.attrs)) await sftpRmRf(sftp, path)
      else await call(sftp, 'unlink', path)
      purged++
    } catch (err) {
      errors.push({ id: item.filename, error: err.message })
    }
  }
  return { purged, errors }
}
