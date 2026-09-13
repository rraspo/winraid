import { shell } from 'electron'
import { unlink } from 'fs/promises'

// Deletes a file the app is removing on the user's behalf (a move
// connection, or mirror_clean's copy-then-clean) — never a delete the user
// asked for in the moment, so it must stay recoverable.
//
// Sends the file to the Recycle Bin first. Falls back to an outright unlink
// when the bin refuses: a network drive, or a volume with the bin disabled.
// The fallback is not optional — a move connection promises the local copy
// is gone after upload, so a refused bin must not leave the file behind.
// An already-gone file counts as done either way.
export async function deleteLocalFile(path) {
  try {
    await shell.trashItem(path)
    return { ok: true, recycled: true }
  } catch (trashErr) {
    try {
      await unlink(path)
    } catch (unlinkErr) {
      if (unlinkErr.code !== 'ENOENT') {
        return { ok: false, error: unlinkErr.message }
      }
    }
    return { ok: true, recycled: false, reason: trashErr.message }
  }
}
