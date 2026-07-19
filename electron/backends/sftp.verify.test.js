// @vitest-environment node
// WR-01 acceptance: the SFTP skip decision must be an integrity check, not an
// existence check. A remote file that merely exists (truncated, zero-byte, or
// stale) must not cause a skip — combined with move/mirror_clean deletion,
// that turns a leftover remote stub into local data loss.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const LOCAL_SIZE = 4 * 1024 * 1024 * 1024 // the 4 GB movie.mkv from the audit scenario

const state = vi.hoisted(() => ({
  remoteStat: null, // null → sftp.stat errors (file absent); object → resolves with it
  fastPut: null,    // vi.fn per test, records upload attempts
}))

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('events')
  class Client extends EventEmitter {
    connect() { setImmediate(() => this.emit('ready')) }
    sftp(callback) {
      callback(null, {
        stat: (remotePath, statCallback) => {
          if (state.remoteStat) statCallback(null, state.remoteStat)
          else statCallback(Object.assign(new Error('No such file'), { code: 2 }))
        },
        mkdir: (remotePath, mkdirCallback) => mkdirCallback(null),
        fastPut: (...args) => state.fastPut(...args),
      })
    }
    end() {}
  }
  return { Client }
})

vi.mock('fs/promises', () => ({
  readFile: vi.fn(() => Promise.resolve(Buffer.from('key'))),
  stat: vi.fn(() => Promise.resolve({
    size: LOCAL_SIZE,
    atimeMs: 1_700_000_000_000,
    mtimeMs: 1_700_000_000_000,
  })),
}))
vi.mock('../sftp-helpers.js', () => ({ setSftpTimestamps: vi.fn(() => Promise.resolve()) }))
vi.mock('../logger.js', () => ({ log: vi.fn() }))

import { createSftpBackend } from './sftp.js'

const CFG = { host: 'nas.local', port: 22, username: 'backup', password: 'x', remotePath: '/backups' }
const JOB = { srcPath: 'C:\\watch\\movie.mkv', filename: 'movie.mkv', relPath: 'movie.mkv', remoteDest: null }

describe('SFTP skip integrity (WR-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.fastPut = vi.fn((localPath, remotePath, opts, done) => done(null))
    state.remoteStat = null
  })

  it('uploads instead of skipping when the remote file exists with a DIFFERENT size', async () => {
    // The audit scenario: a 0-byte leftover from an aborted earlier run.
    state.remoteStat = { size: 0, mtime: 1_700_000_000 }

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn())

    expect(result?.skipped).not.toBe(true)
    expect(state.fastPut).toHaveBeenCalledTimes(1)
  })

  it('skips only when the remote size matches the local size', async () => {
    state.remoteStat = { size: LOCAL_SIZE, mtime: 1_700_000_000 }

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn())

    expect(result).toEqual({ skipped: true })
    expect(state.fastPut).not.toHaveBeenCalled()
  })

  it('still uploads normally when the remote file does not exist', async () => {
    state.remoteStat = null

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn())

    expect(result?.skipped).not.toBe(true)
    expect(state.fastPut).toHaveBeenCalledTimes(1)
  })
})
