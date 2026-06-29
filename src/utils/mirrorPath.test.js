import { describe, it, expect } from 'vitest'
import { localMirrorPath } from './mirrorPath'

const sftpConn = (over = {}) => ({
  folderMode: 'mirror',
  localFolder: 'Z:\\winraid\\kepler',
  sftp: { remotePath: '/mnt/user/kepler' },
  ...over,
})

describe('localMirrorPath', () => {
  it('returns null when the connection is not a mirror mode', () => {
    expect(localMirrorPath(sftpConn({ folderMode: 'flat' }), '/mnt/user/kepler/AM')).toBeNull()
  })

  it('maps the sync root itself to the local folder', () => {
    expect(localMirrorPath(sftpConn(), '/mnt/user/kepler')).toBe('Z:\\winraid\\kepler')
  })

  it('maps a remote subpath onto the local tree with OS separators', () => {
    expect(localMirrorPath(sftpConn(), '/mnt/user/kepler/AM/library'))
      .toBe('Z:\\winraid\\kepler\\AM\\library')
  })

  it('works for mirror_clean too', () => {
    expect(localMirrorPath(sftpConn({ folderMode: 'mirror_clean' }), '/mnt/user/kepler/AM'))
      .toBe('Z:\\winraid\\kepler\\AM')
  })

  it('returns null for a remote path outside the sync root', () => {
    expect(localMirrorPath(sftpConn(), '/mnt/user/other/AM')).toBeNull()
  })

  it('tolerates trailing slashes on base and path', () => {
    expect(localMirrorPath(sftpConn({ sftp: { remotePath: '/mnt/user/kepler/' } }), '/mnt/user/kepler/AM/'))
      .toBe('Z:\\winraid\\kepler\\AM')
  })

  it('uses forward slashes when the local folder is POSIX-style', () => {
    expect(localMirrorPath(sftpConn({ localFolder: '/home/u/sync' }), '/mnt/user/kepler/AM/x'))
      .toBe('/home/u/sync/AM/x')
  })

  it('supports SMB connections (smb.remotePath)', () => {
    const conn = { folderMode: 'mirror', localFolder: 'Z:\\s', smb: { remotePath: '/share/s' } }
    expect(localMirrorPath(conn, '/share/s/a/b')).toBe('Z:\\s\\a\\b')
  })

  it('returns null when localFolder or base is missing', () => {
    expect(localMirrorPath(sftpConn({ localFolder: '' }), '/mnt/user/kepler/AM')).toBeNull()
    expect(localMirrorPath({ folderMode: 'mirror', localFolder: 'Z:\\x', sftp: {} }, '/a')).toBeNull()
  })

  it('returns null for a non-string remote path or missing conn', () => {
    expect(localMirrorPath(sftpConn(), null)).toBeNull()
    expect(localMirrorPath(null, '/mnt/user/kepler')).toBeNull()
  })
})
