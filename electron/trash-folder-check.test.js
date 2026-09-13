// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { posix } from 'path'
import { checkTrashFolder } from './trash-folder-check.js'
import { TRASH_DIR } from './trash.js'

// Contract under test — a trash folder is checked when it is saved, not when
// the first delete goes wrong.
//
// Moving a file into the trash is only instant when it is a rename. If the
// folder sits on a different filesystem from the connection's folder — outside
// a mergerfs or Unraid union mount, or on another share — every delete would
// copy the whole file instead, and a large video would take minutes.
//
// SFTP's rename never copies, so a test rename answers the question: a small
// probe file is written in the connection's folder and renamed into the
// trash. If that rename is refused, the folder is refused with a plain reason.
// The probe is cleaned up whatever happens.

const ROOT = '/mnt/user/media'

const sftpError = (code, message) => Object.assign(new Error(message), { code })

// A small in-memory SFTP server with ssh2's callback signatures and status
// codes (2 = no such file, 3 = permission denied, 4 = failure).
function fakeSftp(dirs, { renameError = null } = {}) {
  const nodes = new Map([['/', 'dir']])
  const addDir = (path) => {
    if (nodes.has(path)) return
    addDir(posix.dirname(path))
    nodes.set(path, 'dir')
  }
  dirs.forEach(addDir)
  return {
    nodes,
    stat: vi.fn((path, cb) => nodes.has(path)
      ? cb(null, { mode: nodes.get(path) === 'dir' ? 0o040755 : 0o100644, isDirectory: () => nodes.get(path) === 'dir' })
      : cb(sftpError(2, 'No such file'))),
    mkdir: vi.fn((path, cb) => {
      if (nodes.has(path)) return cb(sftpError(4, 'Failure'))
      if (!nodes.has(posix.dirname(path))) return cb(sftpError(2, 'No such file'))
      nodes.set(path, 'dir')
      cb(null)
    }),
    writeFile: vi.fn((path, _data, ...rest) => {
      const cb = rest[rest.length - 1]
      if (!nodes.has(posix.dirname(path))) return cb(sftpError(2, 'No such file'))
      nodes.set(path, 'file')
      cb(null)
    }),
    rename: vi.fn((src, dst, cb) => {
      if (renameError) return cb(renameError)
      if (!nodes.has(src) || !nodes.has(posix.dirname(dst))) return cb(sftpError(4, 'Failure'))
      nodes.set(dst, nodes.get(src))
      nodes.delete(src)
      cb(null)
    }),
    unlink: vi.fn((path, cb) => {
      if (nodes.get(path) !== 'file') return cb(sftpError(2, 'No such file'))
      nodes.delete(path)
      cb(null)
    }),
  }
}

const files = (sftp) => [...sftp.nodes.entries()].filter(([, type]) => type === 'file').map(([path]) => path)
const deps = (sftp) => ({ sftp, newId: () => 'probe1' })

describe('checking a trash folder before it is saved', () => {
  it('accepts a folder a file can be renamed into, and leaves no probe behind', async () => {
    const sftp = fakeSftp([ROOT, `${ROOT}/keep`])
    const result = await checkTrashFolder(deps(sftp), { root: ROOT, folder: `${ROOT}/keep` })

    expect(result).toEqual({ ok: true })
    expect(sftp.rename).toHaveBeenCalled()
    expect(sftp.nodes.get(`${ROOT}/keep/${TRASH_DIR}`)).toBe('dir')
    expect(files(sftp)).toEqual([])
  })

  it('accepts the connection’s own folder', async () => {
    const sftp = fakeSftp([ROOT])
    expect(await checkTrashFolder(deps(sftp), { root: ROOT, folder: ROOT })).toEqual({ ok: true })
  })

  it('refuses a folder the file would have to be copied into, and says why', async () => {
    const sftp = fakeSftp([ROOT, '/mnt/cache/trash'], { renameError: sftpError(4, 'Failure') })
    const result = await checkTrashFolder(deps(sftp), { root: ROOT, folder: '/mnt/cache/trash' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cop(y|ied)/i)
    expect(files(sftp)).toEqual([])
  })

  it('refuses a folder it has no permission to write to, and says that instead', async () => {
    const sftp = fakeSftp([ROOT, '/srv/locked'], { renameError: sftpError(3, 'Permission denied') })
    const result = await checkTrashFolder(deps(sftp), { root: ROOT, folder: '/srv/locked' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/permission/i)
    expect(files(sftp)).toEqual([])
  })

  it('refuses a folder that does not exist rather than creating it', async () => {
    const sftp = fakeSftp([ROOT])
    const result = await checkTrashFolder(deps(sftp), { root: ROOT, folder: `${ROOT}/nowhere` })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not exist|doesn['’]t exist/i)
    expect(sftp.nodes.has(`${ROOT}/nowhere`)).toBe(false)
  })

  it('refuses a path that is not an absolute remote folder, without touching the NAS', async () => {
    for (const folder of ['', 'relative/trash', '/mnt/user/../etc']) {
      const sftp = fakeSftp([ROOT])
      const result = await checkTrashFolder(deps(sftp), { root: ROOT, folder })
      expect(result.ok).toBe(false)
      expect(sftp.writeFile).not.toHaveBeenCalled()
      expect(sftp.rename).not.toHaveBeenCalled()
    }
  })

  it('refuses a folder inside an existing trash', async () => {
    const sftp = fakeSftp([ROOT, `${ROOT}/${TRASH_DIR}/entry1`])
    const result = await checkTrashFolder(deps(sftp), { root: ROOT, folder: `${ROOT}/${TRASH_DIR}/entry1` })

    expect(result.ok).toBe(false)
    expect(sftp.rename).not.toHaveBeenCalled()
  })
})
