// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { posix } from 'path'
import { moveToTrash, listTrash, restoreFromTrash, purgeTrash } from './remote-trash.js'
import { TRASH_DIR, TRASH_META, trashDestination } from './trash.js'

// The trash operations run against an in-memory SFTP server, so what is
// asserted is where things end up on the "NAS", not which calls were made.

const ROOT = '/mnt/user/media'
const TRASH = `${ROOT}/${TRASH_DIR}`

function sftpError(code, message) {
  return Object.assign(new Error(message), { code })
}
const noSuchFile = () => sftpError(2, 'No such file')
const failure = () => sftpError(4, 'Failure')

// A tiny SFTP server over a Map of absolute path -> node, with ssh2's callback
// signatures and its numeric status codes (2 = no such file, 4 = failure).
function fakeSftp(initial = {}) {
  const nodes = new Map([['/', { type: 'dir', mtime: 1 }]])
  const parentOf = (path) => posix.dirname(path)
  const childrenOf = (path) => [...nodes.keys()].filter((key) => key !== path && parentOf(key) === path)
  const attrsOf = (node) => ({
    mode: node.type === 'dir' ? 0o040755 : 0o100644,
    size: node.type === 'dir' ? 4096 : Buffer.byteLength(node.content ?? ''),
    mtime: node.mtime ?? 1,
    isDirectory: () => node.type === 'dir',
  })
  const addDir = (path) => {
    if (nodes.has(path)) return
    addDir(parentOf(path))
    nodes.set(path, { type: 'dir', mtime: 1 })
  }
  const addFile = (path, content) => {
    addDir(parentOf(path))
    nodes.set(path, { type: 'file', content, mtime: 1 })
  }
  for (const [path, content] of Object.entries(initial)) {
    if (content === null) addDir(path)
    else addFile(path, content)
  }

  const optionalCallback = (args) => args[args.length - 1]

  const sftp = {
    nodes,
    stat: vi.fn((path, cb) => {
      const node = nodes.get(path)
      if (!node) return cb(noSuchFile())
      cb(null, attrsOf(node))
    }),
    readdir: vi.fn((path, cb) => {
      const node = nodes.get(path)
      if (!node || node.type !== 'dir') return cb(noSuchFile())
      cb(null, childrenOf(path).map((child) => ({ filename: posix.basename(child), attrs: attrsOf(nodes.get(child)) })))
    }),
    mkdir: vi.fn((path, cb) => {
      if (nodes.has(path)) return cb(failure())
      if (!nodes.has(parentOf(path))) return cb(noSuchFile())
      nodes.set(path, { type: 'dir', mtime: 1 })
      cb(null)
    }),
    rmdir: vi.fn((path, cb) => {
      const node = nodes.get(path)
      if (!node || node.type !== 'dir') return cb(noSuchFile())
      if (childrenOf(path).length) return cb(failure())
      nodes.delete(path)
      cb(null)
    }),
    unlink: vi.fn((path, cb) => {
      const node = nodes.get(path)
      if (!node || node.type !== 'file') return cb(noSuchFile())
      nodes.delete(path)
      cb(null)
    }),
    readFile: vi.fn((path, ...rest) => {
      const cb = optionalCallback(rest)
      const node = nodes.get(path)
      if (!node || node.type !== 'file') return cb(noSuchFile())
      cb(null, node.content)
    }),
    writeFile: vi.fn((path, data, ...rest) => {
      const cb = optionalCallback(rest)
      if (!nodes.has(parentOf(path))) return cb(noSuchFile())
      nodes.set(path, { type: 'file', content: String(data), mtime: 1 })
      cb(null)
    }),
    rename: vi.fn((src, dst, cb) => {
      if (!nodes.has(src) || nodes.has(dst) || !nodes.has(parentOf(dst))) return cb(failure())
      for (const key of [...nodes.keys()]) {
        if (key === src || key.startsWith(`${src}/`)) {
          nodes.set(dst + key.slice(src.length), nodes.get(key))
          nodes.delete(key)
        }
      }
      cb(null)
    }),
  }
  return sftp
}

function depsFor(sftp, overrides = {}) {
  let counter = 0
  return {
    sftp,
    exec: null,
    move: vi.fn((src, dst) => new Promise((resolve) => {
      sftp.rename(src, dst, (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }))
    })),
    newId: () => `entry${++counter}`,
    now: () => 1_700_000_000_000,
    warn: vi.fn(),
    ...overrides,
  }
}

const readMeta = (sftp, id) => JSON.parse(sftp.nodes.get(`${TRASH}/${id}/${TRASH_META}`).content)

describe('moveToTrash', () => {
  it('moves a file into its own trash entry instead of unlinking it, and records it', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'jpeg-bytes' })
    const deps = depsFor(sftp)

    const { entry, trashPath } = await moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)

    expect(trashPath).toBe(trashDestination(ROOT, `${ROOT}/photos/a.jpg`, 'entry1'))
    expect(sftp.nodes.has(`${ROOT}/photos/a.jpg`)).toBe(false)
    expect(sftp.nodes.get(trashPath).content).toBe('jpeg-bytes')
    expect(sftp.unlink).not.toHaveBeenCalled()
    expect(sftp.rmdir).not.toHaveBeenCalled()
    expect(deps.move).toHaveBeenCalledWith(`${ROOT}/photos/a.jpg`, trashPath)

    const meta = readMeta(sftp, 'entry1')
    expect(meta).toEqual({
      id: 'entry1',
      originalPath: `${ROOT}/photos/a.jpg`,
      name: 'a.jpg',
      deletedAt: 1_700_000_000_000,
      size: Buffer.byteLength('jpeg-bytes'),
      isDir: false,
    })
    expect(entry).toEqual(meta)
  })

  it('moves a whole directory without removing anything, sized by du over exec', async () => {
    const sftp = fakeSftp({
      [`${ROOT}/albums/trip/one.jpg`]: '1',
      [`${ROOT}/albums/trip/nested/two.jpg`]: '2',
    })
    const exec = vi.fn(async () => ({ code: 0, stdout: `52428800\t${ROOT}/albums/trip\n` }))
    const deps = depsFor(sftp, { exec })

    const { trashPath } = await moveToTrash(deps, ROOT, `${ROOT}/albums/trip`, true)

    expect(exec.mock.calls[0][0]).toBe(`du -sb -- '${ROOT}/albums/trip'`)
    expect(sftp.nodes.has(`${ROOT}/albums/trip`)).toBe(false)
    expect(sftp.nodes.get(`${trashPath}/nested/two.jpg`).content).toBe('2')
    expect(sftp.unlink).not.toHaveBeenCalled()
    expect(sftp.rmdir).not.toHaveBeenCalled()
    expect(readMeta(sftp, 'entry1')).toMatchObject({ name: 'trip', size: 52428800, isDir: true })
  })

  it('records a directory size of 0 when du does not answer', async () => {
    const sftp = fakeSftp({ [`${ROOT}/albums/trip/one.jpg`]: '1' })
    const exec = vi.fn(async () => ({ code: 1, stdout: '' }))
    await moveToTrash(depsFor(sftp, { exec }), ROOT, `${ROOT}/albums/trip`, true)
    expect(readMeta(sftp, 'entry1').size).toBe(0)

    const noShell = fakeSftp({ [`${ROOT}/albums/trip/one.jpg`]: '1' })
    await moveToTrash(depsFor(noShell), ROOT, `${ROOT}/albums/trip`, true)
    expect(readMeta(noShell, 'entry1').size).toBe(0)
  })

  it('keeps two deletes of the same name apart', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'first', [`${ROOT}/videos/a.jpg`]: 'second' })
    const deps = depsFor(sftp)
    const first = await moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)
    const second = await moveToTrash(deps, ROOT, `${ROOT}/videos/a.jpg`, false)
    expect(sftp.nodes.get(first.trashPath).content).toBe('first')
    expect(sftp.nodes.get(second.trashPath).content).toBe('second')
  })

  it('leaves the item where it was, and no empty entry behind, when the move fails', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'jpeg-bytes' })
    const deps = depsFor(sftp, { move: vi.fn(async () => ({ ok: false, error: 'Permission denied' })) })

    await expect(moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)).rejects.toThrow('Permission denied')
    expect(sftp.nodes.get(`${ROOT}/photos/a.jpg`).content).toBe('jpeg-bytes')
    expect(sftp.nodes.has(`${TRASH}/entry1`)).toBe(false)
  })

  it('refuses to trash something already in the trash', async () => {
    const sftp = fakeSftp({ [`${TRASH}/old/a.jpg`]: 'x' })
    const deps = depsFor(sftp)
    await expect(moveToTrash(deps, ROOT, `${TRASH}/old/a.jpg`, false)).rejects.toThrow(/already in the trash/i)
    expect(deps.move).not.toHaveBeenCalled()
  })
})

describe('listTrash', () => {
  it('lists recorded entries newest first, each restorable', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'a', [`${ROOT}/photos/b.jpg`]: 'b' })
    let clock = 1_000
    const deps = depsFor(sftp, { now: () => (clock += 1_000) })
    await moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)
    await moveToTrash(deps, ROOT, `${ROOT}/photos/b.jpg`, false)

    const entries = await listTrash(deps, ROOT)
    expect(entries.map((entry) => entry.name)).toEqual(['b.jpg', 'a.jpg'])
    expect(entries[1]).toEqual({
      id: 'entry1', originalPath: `${ROOT}/photos/a.jpg`, name: 'a.jpg',
      deletedAt: 2_000, size: 1, isDir: false, restorable: true,
    })
  })

  it('still lists an entry whose meta.json is missing, marked not restorable', async () => {
    const sftp = fakeSftp({ [`${TRASH}/orphan/clip.mp4`]: 'video' })
    const entries = await listTrash(depsFor(sftp), ROOT)
    expect(entries).toEqual([
      expect.objectContaining({ id: 'orphan', name: 'clip.mp4', originalPath: null, restorable: false }),
    ])
  })

  it('still lists an entry whose meta.json is unreadable, marked not restorable', async () => {
    const sftp = fakeSftp({
      [`${TRASH}/garbled/clip.mp4`]: 'video',
      [`${TRASH}/garbled/${TRASH_META}`]: '{"id": "garbled", "originalPa',
    })
    const entries = await listTrash(depsFor(sftp), ROOT)
    expect(entries).toEqual([
      expect.objectContaining({ id: 'garbled', name: 'clip.mp4', restorable: false }),
    ])
  })

  it('treats a manifest pointing outside its own entry as unreadable', async () => {
    const sftp = fakeSftp({
      [`${TRASH}/tampered/clip.mp4`]: 'video',
      [`${TRASH}/tampered/${TRASH_META}`]: JSON.stringify({
        id: 'tampered', originalPath: `${ROOT}/clip.mp4`, name: '../../etc', deletedAt: 1, size: 1, isDir: false,
      }),
    })
    const [entry] = await listTrash(depsFor(sftp), ROOT)
    expect(entry.restorable).toBe(false)
  })

  it('treats a manifest whose original path climbs out with .. as unreadable', async () => {
    const sftp = fakeSftp({
      [`${TRASH}/climbing/clip.mp4`]: 'video',
      [`${TRASH}/climbing/${TRASH_META}`]: JSON.stringify({
        id: 'climbing', originalPath: `${ROOT}/../../clip.mp4`, name: 'clip.mp4', deletedAt: 1, size: 1, isDir: false,
      }),
    })
    const [entry] = await listTrash(depsFor(sftp), ROOT)
    expect(entry.restorable).toBe(false)
  })

  it('returns nothing when the connection has never trashed anything', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'a' })
    expect(await listTrash(depsFor(sftp), ROOT)).toEqual([])
  })
})

describe('restoreFromTrash', () => {
  it('puts an entry back where it came from and clears the entry', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'jpeg-bytes' })
    const deps = depsFor(sftp)
    await moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)

    const result = await restoreFromTrash(deps, ROOT, 'entry1')

    expect(result).toEqual({ restoredPath: `${ROOT}/photos/a.jpg`, renamed: false })
    expect(sftp.nodes.get(`${ROOT}/photos/a.jpg`).content).toBe('jpeg-bytes')
    expect(sftp.nodes.has(`${TRASH}/entry1`)).toBe(false)
  })

  it('lands on a renamed path when something took the original name, leaving that untouched', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'deleted-version' })
    const deps = depsFor(sftp)
    await moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)
    sftp.nodes.set(`${ROOT}/photos/a.jpg`, { type: 'file', content: 'new-version', mtime: 1 })

    const result = await restoreFromTrash(deps, ROOT, 'entry1')

    expect(result).toEqual({ restoredPath: `${ROOT}/photos/a (restored).jpg`, renamed: true })
    expect(sftp.nodes.get(`${ROOT}/photos/a.jpg`).content).toBe('new-version')
    expect(sftp.nodes.get(`${ROOT}/photos/a (restored).jpg`).content).toBe('deleted-version')
  })

  it('recreates the folder it came from when that folder is gone too', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/2024/a.jpg`]: 'jpeg-bytes' })
    const deps = depsFor(sftp)
    await moveToTrash(deps, ROOT, `${ROOT}/photos/2024/a.jpg`, false)
    sftp.nodes.delete(`${ROOT}/photos/2024`)
    sftp.nodes.delete(`${ROOT}/photos`)
    expect([...sftp.nodes.keys()].some((key) => key.startsWith(`${ROOT}/photos`))).toBe(false)

    await restoreFromTrash(deps, ROOT, 'entry1')
    expect(sftp.nodes.get(`${ROOT}/photos/2024/a.jpg`).content).toBe('jpeg-bytes')
  })

  it('refuses to restore an entry with no readable record, and leaves it in the trash', async () => {
    const sftp = fakeSftp({ [`${TRASH}/orphan/clip.mp4`]: 'video' })
    const deps = depsFor(sftp)
    await expect(restoreFromTrash(deps, ROOT, 'orphan')).rejects.toThrow(/cannot be restored/i)
    expect(deps.move).not.toHaveBeenCalled()
    expect(sftp.nodes.get(`${TRASH}/orphan/clip.mp4`).content).toBe('video')
  })

  it('rejects an id that is not a single entry name', async () => {
    const deps = depsFor(fakeSftp())
    await expect(restoreFromTrash(deps, ROOT, '../photos')).rejects.toThrow(/invalid trash entry/i)
  })
})

describe('purgeTrash', () => {
  it('permanently deletes one entry, including one with no record', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'a', [`${TRASH}/orphan/clip.mp4`]: 'video' })
    const deps = depsFor(sftp)
    await moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)

    expect(await purgeTrash(deps, ROOT, 'orphan')).toEqual({ purged: 1, errors: [] })
    expect(sftp.nodes.has(`${TRASH}/orphan`)).toBe(false)
    expect(sftp.nodes.has(`${TRASH}/entry1`)).toBe(true)
  })

  it('empties the whole trash', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'a', [`${ROOT}/albums/trip/one.jpg`]: '1' })
    const deps = depsFor(sftp)
    await moveToTrash(deps, ROOT, `${ROOT}/photos/a.jpg`, false)
    await moveToTrash(deps, ROOT, `${ROOT}/albums/trip`, true)

    expect(await purgeTrash(deps, ROOT)).toEqual({ purged: 2, errors: [] })
    expect(await listTrash(deps, ROOT)).toEqual([])
  })

  it('reports an empty trash as nothing purged', async () => {
    expect(await purgeTrash(depsFor(fakeSftp({ [`${ROOT}/a.jpg`]: 'a' })), ROOT)).toEqual({ purged: 0, errors: [] })
  })

  it('rejects an id that is not a single entry name', async () => {
    const sftp = fakeSftp({ [`${ROOT}/photos/a.jpg`]: 'a' })
    await expect(purgeTrash(depsFor(sftp), ROOT, '..')).rejects.toThrow(/invalid trash entry/i)
    expect(sftp.nodes.has(`${ROOT}/photos/a.jpg`)).toBe(true)
  })
})
