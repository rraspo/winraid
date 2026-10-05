// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Contract under test — the trash is something a connection opts into.
//
// A remote delete only goes to the trash when the connection has a trash
// folder set in Settings. Without one it is the permanent delete it always
// was, and the delete dialog says so. Choosing the folder is the user's call,
// because the right place depends on how their NAS lays out its disks.
//
// The one thing that must never happen: a delete that was meant to go to the
// trash, failing to get there, and quietly falling back to deleting the file
// for good. A failed trash move is a failed delete, and the file stays put.

const moveToTrash = vi.fn()
const sftpRmRf    = vi.fn()

vi.mock('./remote-trash.js', () => ({ moveToTrash: (...args) => moveToTrash(...args) }))
vi.mock('./sftp-helpers.js', () => ({ sftpRmRf: (...args) => sftpRmRf(...args) }))

const { deleteRemote } = await import('./remote-delete.js')

function depsWith() {
  return {
    sftp: { unlink: vi.fn((_path, cb) => cb(null)) },
    move: vi.fn(),
    newId: () => 'entry1',
    now: () => 1_700_000_000_000,
    warn: vi.fn(),
    exec: null,
  }
}

beforeEach(() => {
  moveToTrash.mockReset()
  sftpRmRf.mockReset()
})

describe('a connection with no trash folder', () => {
  it('deletes a file permanently', async () => {
    const deps = depsWith()
    const result = await deleteRemote(deps, { trashFolder: null, path: '/mnt/user/media/a.jpg', isDir: false })

    expect(deps.sftp.unlink).toHaveBeenCalledWith('/mnt/user/media/a.jpg', expect.any(Function))
    expect(moveToTrash).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, trashed: false })
  })

  it('deletes a folder and everything in it permanently', async () => {
    const deps = depsWith()
    sftpRmRf.mockResolvedValue(undefined)
    const result = await deleteRemote(deps, { trashFolder: undefined, path: '/mnt/user/media/album', isDir: true })

    expect(sftpRmRf).toHaveBeenCalledWith(deps.sftp, '/mnt/user/media/album')
    expect(moveToTrash).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, trashed: false })
  })

  it('treats a blank folder as no folder', async () => {
    const deps = depsWith()
    const result = await deleteRemote(deps, { trashFolder: '   ', path: '/mnt/user/media/a.jpg', isDir: false })

    expect(moveToTrash).not.toHaveBeenCalled()
    expect(result.trashed).toBe(false)
  })
})

describe('a connection with a trash folder', () => {
  it('moves the item into that folder’s trash instead of deleting it', async () => {
    const deps = depsWith()
    moveToTrash.mockResolvedValue({ entry: {}, trashPath: '/mnt/user/media/.winraid-trash/entry1/a.jpg' })
    const result = await deleteRemote(deps, { trashFolder: '/mnt/user/media', path: '/mnt/user/media/photos/a.jpg', isDir: false })

    expect(moveToTrash).toHaveBeenCalledWith(deps, '/mnt/user/media', '/mnt/user/media/photos/a.jpg', false)
    expect(deps.sftp.unlink).not.toHaveBeenCalled()
    expect(sftpRmRf).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, trashed: true, trashPath: '/mnt/user/media/.winraid-trash/entry1/a.jpg' })
  })

  it('never falls back to a permanent delete when the move into the trash fails', async () => {
    const deps = depsWith()
    moveToTrash.mockRejectedValue(new Error('Failure'))

    await expect(
      deleteRemote(deps, { trashFolder: '/mnt/user/media', path: '/mnt/user/media/album', isDir: true })
    ).rejects.toThrow('Failure')
    expect(deps.sftp.unlink).not.toHaveBeenCalled()
    expect(sftpRmRf).not.toHaveBeenCalled()
  })
})
