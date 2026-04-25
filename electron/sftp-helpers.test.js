// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('path', () => ({ join: (a, b) => `${a}/${b}` }))

import { mkdirSync } from 'fs'
import { sftpRmRf, backupWalkRemote, remoteWalkCreate, mediaWalk } from './sftp-helpers.js'

function makeSftp({ dirs = {} } = {}) {
  return {
    readdir: vi.fn((path, cb) => {
      const items = dirs[path] ?? []
      cb(null, items)
    }),
    unlink: vi.fn((_p, cb) => cb(null)),
    rmdir: vi.fn((_p, cb) => cb(null)),
  }
}

function dirItem(name) {
  return { filename: name, attrs: { mode: 0o040755 } }
}

function fileItem(name) {
  return { filename: name, attrs: { mode: 0o100644, size: 100, mtime: 0 } }
}

describe('sftpRmRf', () => {
  it('deletes a flat directory', async () => {
    const sftp = makeSftp({ dirs: { '/a': [fileItem('x.txt')] } })
    await sftpRmRf(sftp, '/a')
    expect(sftp.unlink).toHaveBeenCalledWith('/a/x.txt', expect.any(Function))
    expect(sftp.rmdir).toHaveBeenCalledWith('/a', expect.any(Function))
  })

  it('rejects when depth exceeds maxDepth', async () => {
    const dirs = {}
    let path = '/a'
    for (let i = 0; i < 52; i++) {
      const child = `${path}/sub`
      dirs[path] = [dirItem('sub')]
      path = child
    }
    dirs[path] = []
    const sftp = makeSftp({ dirs })
    await expect(sftpRmRf(sftp, '/a')).rejects.toThrow('Directory tree too deep')
  })
})

describe('backupWalkRemote', () => {
  it('collects file entries from a flat directory', async () => {
    const sftp = makeSftp({
      dirs: { '/src': [fileItem('photo.jpg')] },
    })
    const results = await backupWalkRemote(sftp, '/src', '')
    expect(results).toEqual([
      expect.objectContaining({ remotePath: '/src/photo.jpg', relPath: 'photo.jpg' }),
    ])
  })

  it('rejects when depth exceeds maxDepth', async () => {
    const dirs = {}
    let path = '/src'
    for (let i = 0; i < 52; i++) {
      const child = `${path}/sub`
      dirs[path] = [{ filename: 'sub', attrs: { mode: 0o040755 } }]
      path = child
    }
    dirs[path] = []
    const sftp = makeSftp({ dirs })
    await expect(backupWalkRemote(sftp, '/src', '')).rejects.toThrow('Directory tree too deep')
  })
})

describe('remoteWalkCreate', () => {
  it('creates local directory and recurses into subdirectories', async () => {
    const sftp = makeSftp({
      dirs: {
        '/src': [dirItem('sub')],
        '/src/sub': [fileItem('file.txt')],
      },
    })
    const created = []
    await remoteWalkCreate(sftp, '/src', '/local', created)
    expect(mkdirSync).toHaveBeenCalledWith('/local', { recursive: true })
    expect(mkdirSync).toHaveBeenCalledWith('/local/sub', { recursive: true })
    expect(created).toContain('/local')
    expect(created).toContain('/local/sub')
  })

  it('skips dot-file directories', async () => {
    const sftp = makeSftp({
      dirs: {
        '/src': [dirItem('.hidden'), fileItem('visible.txt')],
      },
    })
    const created = []
    await remoteWalkCreate(sftp, '/src', '/local', created)
    expect(sftp.readdir).not.toHaveBeenCalledWith('/src/.hidden', expect.any(Function))
  })

  it('rejects when depth exceeds maxDepth', async () => {
    const dirs = {}
    let path = '/src'
    for (let i = 0; i < 52; i++) {
      const child = `${path}/sub`
      dirs[path] = [dirItem('sub')]
      path = child
    }
    dirs[path] = []
    const sftp = makeSftp({ dirs })
    await expect(remoteWalkCreate(sftp, '/src', '/local', [])).rejects.toThrow('Directory tree too deep')
  })

  it('propagates readdir errors', async () => {
    const sftp = {
      readdir: vi.fn((_p, cb) => cb(new Error('permission denied'))),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    }
    await expect(remoteWalkCreate(sftp, '/src', '/local', [])).rejects.toThrow('permission denied')
  })
})

describe('mediaWalk', () => {
  function flatten(batches) {
    return batches.flat()
  }

  it('emits image and video files and skips non-media', async () => {
    const sftp = makeSftp({
      dirs: {
        '/m': [fileItem('a.jpg'), fileItem('b.mp4'), fileItem('c.pdf'), fileItem('d.txt')],
      },
    })
    const batches = []
    await mediaWalk(sftp, '/m', { onBatch: (b) => batches.push(b) })
    const all = flatten(batches)
    const names = all.map((f) => f.path)
    expect(names).toContain('/m/a.jpg')
    expect(names).toContain('/m/b.mp4')
    expect(names).not.toContain('/m/c.pdf')
    expect(names).not.toContain('/m/d.txt')
  })

  it('recurses into subdirectories when recursive=true', async () => {
    const sftp = makeSftp({
      dirs: {
        '/m':       [dirItem('sub'), fileItem('top.jpg')],
        '/m/sub':   [fileItem('inner.png'), dirItem('deep')],
        '/m/sub/deep': [fileItem('bottom.mp4')],
      },
    })
    const batches = []
    await mediaWalk(sftp, '/m', { onBatch: (b) => batches.push(b), recursive: true })
    const paths = flatten(batches).map((f) => f.path).sort()
    expect(paths).toEqual(['/m/sub/deep/bottom.mp4', '/m/sub/inner.png', '/m/top.jpg'])
  })

  it('does NOT recurse when recursive=false', async () => {
    const sftp = makeSftp({
      dirs: {
        '/m':     [dirItem('sub'), fileItem('top.jpg')],
        '/m/sub': [fileItem('inner.png')],
      },
    })
    const batches = []
    await mediaWalk(sftp, '/m', { onBatch: (b) => batches.push(b), recursive: false })
    const paths = flatten(batches).map((f) => f.path)
    expect(paths).toEqual(['/m/top.jpg'])
    expect(sftp.readdir).not.toHaveBeenCalledWith('/m/sub', expect.any(Function))
  })

  it('stops immediately when signal is already aborted before walk starts', async () => {
    const sftp = makeSftp({
      dirs: { '/m': [fileItem('a.jpg')] },
    })
    const batches = []
    const ac = new AbortController()
    ac.abort()
    await mediaWalk(sftp, '/m', { onBatch: (b) => batches.push(b), signal: ac.signal })
    expect(batches).toEqual([])
    expect(sftp.readdir).not.toHaveBeenCalled()
  })

  it('calls onError for a directory that fails readdir and continues walking', async () => {
    const sftp = {
      readdir: vi.fn((path, cb) => {
        if (path === '/m/bad') return cb(Object.assign(new Error('permission denied'), { code: 3 }))
        if (path === '/m')     return cb(null, [dirItem('bad'), dirItem('ok'), fileItem('top.jpg')])
        if (path === '/m/ok')  return cb(null, [fileItem('inside.png')])
        cb(null, [])
      }),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    }
    const batches = []
    const errors = []
    await mediaWalk(sftp, '/m', {
      onBatch: (b) => batches.push(b),
      onError: (e) => errors.push(e),
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].path).toBe('/m/bad')
    expect(errors[0].msg).toMatch(/permission denied/)
    const paths = flatten(batches).map((f) => f.path).sort()
    expect(paths).toEqual(['/m/ok/inside.png', '/m/top.jpg'])
  })

  it('first batch is exactly 1 item (immediate emit) and rest are buffered', async () => {
    // 25 image files in a single directory
    const files = []
    for (let i = 0; i < 25; i++) files.push(fileItem(`img${i}.jpg`))
    const sftp = makeSftp({ dirs: { '/m': files } })
    const batches = []
    await mediaWalk(sftp, '/m', { onBatch: (b) => batches.push(b) })
    expect(batches[0]).toHaveLength(1)
    // Total emitted equals 25
    expect(flatten(batches)).toHaveLength(25)
    // No batch after the first should be larger than 20 (buffer flush threshold)
    for (let i = 1; i < batches.length; i++) {
      expect(batches[i].length).toBeLessThanOrEqual(20)
    }
  })

  it('emits entries with { path, size, mtime, type } shape with correct values', async () => {
    const sftp = {
      readdir: vi.fn((path, cb) => {
        if (path === '/m') {
          cb(null, [
            { filename: 'pic.jpg', attrs: { mode: 0o100644, size: 1234, mtime: 999 } },
            { filename: 'clip.mp4', attrs: { mode: 0o100644, size: 5555, mtime: 42 } },
          ])
        } else {
          cb(null, [])
        }
      }),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    }
    const batches = []
    await mediaWalk(sftp, '/m', { onBatch: (b) => batches.push(b) })
    const all = flatten(batches)
    const pic = all.find((f) => f.path === '/m/pic.jpg')
    const clip = all.find((f) => f.path === '/m/clip.mp4')
    expect(pic).toEqual({ path: '/m/pic.jpg', size: 1234, mtime: 999, type: 'image' })
    expect(clip).toEqual({ path: '/m/clip.mp4', size: 5555, mtime: 42, type: 'video' })
  })

  it('skips dot-files (both directories and files starting with .)', async () => {
    const sftp = makeSftp({
      dirs: {
        '/m': [
          fileItem('.hidden.jpg'),
          dirItem('.hiddenDir'),
          fileItem('visible.png'),
        ],
        '/m/.hiddenDir': [fileItem('inside.jpg')],
      },
    })
    const batches = []
    await mediaWalk(sftp, '/m', { onBatch: (b) => batches.push(b) })
    const paths = flatten(batches).map((f) => f.path)
    expect(paths).toEqual(['/m/visible.png'])
    expect(sftp.readdir).not.toHaveBeenCalledWith('/m/.hiddenDir', expect.any(Function))
  })
})
