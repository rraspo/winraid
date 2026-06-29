import { describe, it, expect } from 'vitest'
import { describeActivity, failureTitle } from './activity-format.js'

describe('describeActivity', () => {
  it('upload: opens the destination dir and highlights the file', () => {
    const a = describeActivity('upload', { name: 'clip.mp4', destDir: '/media/incoming' })
    expect(a.title).toBe('Uploaded clip.mp4')
    expect(a.detail).toBe('/media/incoming')
    expect(a.nav).toEqual({ kind: 'remote', path: '/media/incoming', highlight: 'clip.mp4' })
  })

  it('move (file): opens the destination dir and highlights the file', () => {
    const a = describeActivity('move', { name: 'photo.jpg', srcDir: '/media/a', dstDir: '/media/archive', isDir: false })
    expect(a.title).toBe('Moved photo.jpg')
    expect(a.detail).toBe('→ /media/archive')
    expect(a.nav).toEqual({ kind: 'remote', path: '/media/archive', highlight: 'photo.jpg' })
  })

  it('move (folder): opens into the moved folder', () => {
    const a = describeActivity('move', { name: 'Trip', srcDir: '/media/a', dstDir: '/media/archive', isDir: true })
    expect(a.nav).toEqual({ kind: 'remote', path: '/media/archive/Trip' })
  })

  it('rename: opens the parent and highlights the new name', () => {
    const a = describeActivity('rename', { oldName: 'a.jpg', newName: 'b.jpg', dir: '/media/a' })
    expect(a.title).toBe('Renamed a.jpg → b.jpg')
    expect(a.nav).toEqual({ kind: 'remote', path: '/media/a', highlight: 'b.jpg' })
  })

  it('delete: opens the parent with no highlight', () => {
    const a = describeActivity('delete', { name: 'old.mkv', parentDir: '/media/a' })
    expect(a.title).toBe('Deleted old.mkv')
    expect(a.detail).toBe('/media/a')
    expect(a.nav).toEqual({ kind: 'remote', path: '/media/a' })
  })

  it('mkdir: opens into the new folder', () => {
    const a = describeActivity('mkdir', { name: 'New', parentDir: '/media' })
    expect(a.title).toBe('Created New')
    expect(a.nav).toEqual({ kind: 'remote', path: '/media/New' })
  })

  it('checkout: reveals the local dir, pluralized count', () => {
    expect(describeActivity('checkout', { count: 1, localDir: 'C:\\sync' }).title).toBe('Checked out 1 folder')
    const a = describeActivity('checkout', { count: 3, localDir: 'C:\\sync' })
    expect(a.title).toBe('Checked out 3 folders')
    expect(a.nav).toEqual({ kind: 'reveal', localPath: 'C:\\sync' })
  })

  it('download: reveals the local dir', () => {
    const a = describeActivity('download', { name: 'album.zip', localDir: 'C:\\dl' })
    expect(a.title).toBe('Downloaded album.zip')
    expect(a.nav).toEqual({ kind: 'reveal', localPath: 'C:\\dl' })
  })

  it('verify-missing: opens the expected remote parent', () => {
    const a = describeActivity('verify-missing', { name: 'clip.mp4', parentDir: '/media/x' })
    expect(a.title).toBe('Missing on NAS: clip.mp4')
    expect(a.nav).toEqual({ kind: 'remote', path: '/media/x' })
  })

  it('joins remote root paths without a double slash', () => {
    const a = describeActivity('mkdir', { name: 'New', parentDir: '/' })
    expect(a.nav.path).toBe('/New')
  })
})

describe('failureTitle', () => {
  it('maps known types to a failure phrase', () => {
    expect(failureTitle('move')).toBe('Move failed')
    expect(failureTitle('delete')).toBe('Delete failed')
  })
  it('falls back for unknown types', () => {
    expect(failureTitle('whatever')).toBe('Operation failed')
  })
})
