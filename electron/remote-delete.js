import { moveToTrash } from './remote-trash.js'
import { sftpRmRf } from './sftp-helpers.js'

// A remote delete is permanent unless the connection has a trash folder
// configured — the user picks the folder in Settings because the right
// place depends on their own disk layout (a union mount makes a rename
// inside the same disk instant; anywhere else it copies).
//
// A failed move into the trash rejects rather than falling back to a
// permanent delete: a delete meant for the trash that cannot get there must
// leave the file exactly where it was.
export async function deleteRemote(deps, { trashFolder, path, isDir }) {
  const folder = typeof trashFolder === 'string' ? trashFolder.trim() : ''

  if (!folder) {
    if (isDir) {
      await sftpRmRf(deps.sftp, path)
    } else {
      await new Promise((resolve, reject) => {
        deps.sftp.unlink(path, (err) => (err ? reject(err) : resolve()))
      })
    }
    return { ok: true, trashed: false }
  }

  const { trashPath } = await moveToTrash(deps, trashFolder, path, isDir)
  return { ok: true, trashed: true, trashPath }
}
