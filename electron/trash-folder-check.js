import { posix } from 'path'
import { validateRemotePath } from './validation.js'
import { TRASH_DIR, trashRoot } from './trash.js'

// ssh2's SFTP status codes.
const NO_SUCH_FILE      = 2
const PERMISSION_DENIED = 3

function call(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (err, value) => (err ? reject(err) : resolve(value)))
  })
}

function insideExistingTrash(folder) {
  return folder.split('/').includes(TRASH_DIR)
}

/**
 * Proves a trash folder is instant to delete into before it is saved.
 *
 * Moving a file into the trash is only free when it is a rename on the same
 * filesystem. A small probe file is written in the connection's own folder
 * (`root`) and renamed into the candidate folder's trash directory — SFTP's
 * rename never copies, so a refused rename means every real delete would
 * copy the whole file instead. The probe is always cleaned up, whatever the
 * outcome.
 */
export async function checkTrashFolder({ sftp, newId }, { root, folder }) {
  if (!validateRemotePath(folder)) {
    return { ok: false, error: 'Enter an absolute remote folder.' }
  }
  if (insideExistingTrash(folder)) {
    return { ok: false, error: 'Choose a folder outside an existing trash.' }
  }

  try {
    const attrs = await call(sftp, 'stat', folder)
    const isDir = ((attrs?.mode ?? 0) & 0o170000) === 0o040000
    if (!isDir) return { ok: false, error: 'That path is not a folder.' }
  } catch (err) {
    if (err.code === NO_SUCH_FILE) return { ok: false, error: 'That folder does not exist.' }
    return { ok: false, error: err.message }
  }

  const probeName = `.winraid-trash-check-${newId()}`
  const probePath = posix.join(root, probeName)
  const destDir   = trashRoot(folder)
  const destPath  = posix.join(destDir, probeName)

  const cleanup = async () => {
    // Whichever of the two locations the probe ended up in (or neither, on
    // an early failure) — remove it, ignoring a missing-file error.
    await call(sftp, 'unlink', probePath).catch(() => {})
    await call(sftp, 'unlink', destPath).catch(() => {})
  }

  try {
    await call(sftp, 'writeFile', probePath, '')
  } catch (err) {
    return { ok: false, error: err.message }
  }

  // The trash directory may already exist from an earlier check or an
  // earlier delete; either way the rename below is the real proof.
  await call(sftp, 'mkdir', destDir).catch(() => {})

  try {
    await call(sftp, 'rename', probePath, destPath)
  } catch (err) {
    await cleanup()
    if (err.code === PERMISSION_DENIED) {
      return { ok: false, error: 'No permission to write to that folder.' }
    }
    return { ok: false, error: 'Every delete would have to copy the file into this folder instead of moving it instantly.' }
  }

  await cleanup()
  return { ok: true }
}
