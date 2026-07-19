import { describe, it, expect } from 'vitest'
import { localMirrorPath } from './mirrorPath'

const sftpConn = (over = {}) => ({
  folderMode: 'mirror',
  localFolder: 'Z:\\winraid\\media',
  sftp: { remotePath: '/mnt/user/media' },
  ...over,
})

describe('localMirrorPath', () => {
  it('returns null when the connection is not a mirror mode', () => {
    expect(localMirrorPath(sftpConn({ folderMode: 'flat' }), '/mnt/user/media/photos')).toBeNull()
  })

  it('maps the sync root itself to the local folder', () => {
    expect(localMirrorPath(sftpConn(), '/mnt/user/media')).toBe('Z:\\winraid\\media')
  })

  it('maps a remote subpath onto the local tree with OS separators', () => {
    expect(localMirrorPath(sftpConn(), '/mnt/user/media/photos/library'))
      .toBe('Z:\\winraid\\media\\photos\\library')
  })

  it('works for mirror_clean too', () => {
    expect(localMirrorPath(sftpConn({ folderMode: 'mirror_clean' }), '/mnt/user/media/photos'))
      .toBe('Z:\\winraid\\media\\photos')
  })

  it('returns null for a remote path outside the sync root', () => {
    expect(localMirrorPath(sftpConn(), '/mnt/user/other/photos')).toBeNull()
  })

  it('tolerates trailing slashes on base and path', () => {
    expect(localMirrorPath(sftpConn({ sftp: { remotePath: '/mnt/user/media/' } }), '/mnt/user/media/photos/'))
      .toBe('Z:\\winraid\\media\\photos')
  })

  it('uses forward slashes when the local folder is POSIX-style', () => {
    expect(localMirrorPath(sftpConn({ localFolder: '/home/u/sync' }), '/mnt/user/media/photos/x'))
      .toBe('/home/u/sync/photos/x')
  })

  it('supports SMB connections (smb.remotePath)', () => {
    const conn = { folderMode: 'mirror', localFolder: 'Z:\\s', smb: { remotePath: '/share/s' } }
    expect(localMirrorPath(conn, '/share/s/a/b')).toBe('Z:\\s\\a\\b')
  })

  it('returns null when localFolder or base is missing', () => {
    expect(localMirrorPath(sftpConn({ localFolder: '' }), '/mnt/user/media/photos')).toBeNull()
    expect(localMirrorPath({ folderMode: 'mirror', localFolder: 'Z:\\x', sftp: {} }, '/a')).toBeNull()
  })

  it('returns null for a non-string remote path or missing conn', () => {
    expect(localMirrorPath(sftpConn(), null)).toBeNull()
    expect(localMirrorPath(null, '/mnt/user/media')).toBeNull()
  })
})
