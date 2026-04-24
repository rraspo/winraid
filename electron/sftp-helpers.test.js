// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { sftpRmRf, backupWalkRemote } from './sftp-helpers.js'

function makeSftp({ dirs = {}, files = [] } = {}) {
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
