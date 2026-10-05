// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Contract under test — a local file the app deletes on your behalf is
// recoverable.
//
// A move connection, and mirror-and-clean, delete the local file once it has
// been uploaded. You never asked for that delete in the moment; it is a
// consequence of the connection's rules, and it happens to every file that
// syncs. It went straight to unlink, so a misconfigured connection quietly
// destroyed originals with nothing to recover from.
//
// It goes to the Windows Recycle Bin instead, where it can be restored the
// way any other deleted file can.
//
// The fallback matters as much as the feature. A move connection promises
// the local file is gone after upload, and some locations have no recycle
// bin at all — a network drive, or a volume with it disabled. When the bin
// refuses, the file is still deleted, and the caller is told which of the
// two happened so it can say so in the log.

const trashItem = vi.fn()
const unlink    = vi.fn()

vi.mock('electron', () => ({ shell: { trashItem: (...args) => trashItem(...args) } }))
vi.mock('fs/promises', () => ({ unlink: (...args) => unlink(...args) }))

const { deleteLocalFile } = await import('./local-delete.js')

beforeEach(() => {
  trashItem.mockReset()
  unlink.mockReset()
})

describe('deleting a local file the app owns', () => {
  it('sends it to the recycle bin', async () => {
    trashItem.mockResolvedValue(undefined)
    const result = await deleteLocalFile('C:\\sync\\photo.jpg')

    expect(trashItem).toHaveBeenCalledWith('C:\\sync\\photo.jpg')
    expect(unlink).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, recycled: true })
  })

  it('deletes it outright when there is no recycle bin to take it', async () => {
    trashItem.mockRejectedValue(new Error('not supported on this volume'))
    unlink.mockResolvedValue(undefined)
    const result = await deleteLocalFile('Z:\\share\\photo.jpg')

    // The move already happened remotely; leaving the local copy behind
    // would break the one promise a move connection makes.
    expect(unlink).toHaveBeenCalledWith('Z:\\share\\photo.jpg')
    expect(result).toEqual({ ok: true, recycled: false, reason: 'not supported on this volume' })
  })

  it('reports a delete that could not happen at all', async () => {
    trashItem.mockRejectedValue(new Error('no bin'))
    unlink.mockRejectedValue(new Error('EPERM'))
    const result = await deleteLocalFile('C:\\locked\\photo.jpg')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('EPERM')
  })

  it('treats an already-gone file as done', async () => {
    const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    trashItem.mockRejectedValue(missing)
    unlink.mockRejectedValue(missing)
    const result = await deleteLocalFile('C:\\sync\\gone.jpg')

    expect(result.ok).toBe(true)
  })
})
