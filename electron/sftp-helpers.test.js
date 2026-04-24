// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({ mkdirSync: vi.fn() }))
vi.mock('path', () => ({ join: (a, b) => `${a}/${b}` }))

import { mkdirSync } from 'fs'
import { sftpRmRf, backupWalkRemote, remoteWalkCreate } from './sftp-helpers.js'

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
