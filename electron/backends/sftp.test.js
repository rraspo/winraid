// @vitest-environment node
// SFTP backend transfer-path coverage (WR-04): remote path construction
// (buildRemotePath), mkdirpRemote's tolerance for "already exists" SFTP
// error codes, and fastPut progress forwarding.
//
// Skip-if-exists integrity (the stat-based size comparison that decides
// whether to skip an upload) is already covered by WR-01's
// sftp.verify.test.js — not repeated here.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  statCalls: [],   // every remotePath passed to sftp.stat, in call order
  statImpl:  null, // (remotePath) => stats, or throws to simulate "not found"
  mkdirImpl: null, // (remotePath) => undefined, or throws to simulate an error
  fastPut:   null, // vi.fn per test, records upload attempts
}))

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('events')
  class Client extends EventEmitter {
    connect() { setImmediate(() => this.emit('ready')) }
    sftp(callback) {
      callback(null, {
        stat: (remotePath, statCallback) => {
          state.statCalls.push(remotePath)
          try {
            statCallback(null, state.statImpl(remotePath))
          } catch (err) {
            statCallback(err)
          }
        },
        mkdir: (remotePath, mkdirCallback) => {
          try {
            state.mkdirImpl(remotePath)
            mkdirCallback(null)
          } catch (err) {
            mkdirCallback(err)
          }
        },
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
    size:    4096,
    atimeMs: 1_700_000_000_000,
    mtimeMs: 1_700_000_000_000,
  })),
}))
vi.mock('../sftp-helpers.js', () => ({ setSftpTimestamps: vi.fn(() => Promise.resolve()) }))
vi.mock('../logger.js', () => ({ log: vi.fn() }))

import { createSftpBackend } from './sftp.js'

const CFG = { host: 'nas.local', port: 22, username: 'backup', password: 'x', remotePath: '/base' }

function notFoundError() {
  return Object.assign(new Error('No such file'), { code: 2 })
}

// buildRemotePath is an internal, unexported helper — it is exercised here
// through transfer(), by inspecting the remotePath argument of the first
// sftp.stat call, which is exactly buildRemotePath's return value.
describe('SFTP remote path construction (buildRemotePath, via transfer)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.statCalls = []
    state.statImpl  = () => { throw notFoundError() } // remote never exists — proceed to upload
    state.mkdirImpl = () => {}                          // directories create cleanly
    state.fastPut   = vi.fn((localPath, remotePath, opts, done) => done(null))
  })

  it('normalizes backslashes to forward slashes when joining base and relPath', async () => {
    const job = { srcPath: 'C:\\watch\\f.mkv', filename: 'f.mkv', relPath: 'sub\\dir\\f.mkv', remoteDest: null }

    await createSftpBackend(CFG).transfer(job, vi.fn())

    expect(state.statCalls[0]).toBe('/base/sub/dir/f.mkv')
  })

  it('collapses duplicate slashes from a trailing base and a leading relPath', async () => {
    const cfgWithTrailingSlash = { ...CFG, remotePath: '/base//nested/' }
    const job = { srcPath: 'C:\\watch\\f.mkv', filename: 'f.mkv', relPath: '//extra//f.mkv', remoteDest: null }

    await createSftpBackend(cfgWithTrailingSlash).transfer(job, vi.fn())

    expect(state.statCalls[0]).toBe('/base/nested/extra/f.mkv')
  })
})

describe('SFTP mkdirpRemote — tolerates "already exists" SFTP error codes', () => {
  const job = { srcPath: 'C:\\watch\\f.mkv', filename: 'f.mkv', relPath: 'sub/f.mkv', remoteDest: null }

  beforeEach(() => {
    vi.clearAllMocks()
    state.statCalls = []
    state.statImpl  = () => { throw notFoundError() } // both the skip-check and every dir-check "miss"
    state.fastPut   = vi.fn((localPath, remotePath, opts, done) => done(null))
  })

  it.each([4, 11])('resolves without throwing when mkdir fails with code %i (dir already exists)', async (code) => {
    state.mkdirImpl = () => { throw Object.assign(new Error('Failure'), { code }) }

    await expect(createSftpBackend(CFG).transfer(job, vi.fn())).resolves.toBeUndefined()
    expect(state.fastPut).toHaveBeenCalledTimes(1)
  })

  it('rejects when mkdir fails with a genuine error code', async () => {
    state.mkdirImpl = () => { throw Object.assign(new Error('Permission denied'), { code: 2 }) }

    await expect(createSftpBackend(CFG).transfer(job, vi.fn())).rejects.toMatchObject({ code: 2 })
    expect(state.fastPut).not.toHaveBeenCalled()
  })
})

describe('SFTP fastPut progress forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.statCalls = []
    state.statImpl  = () => { throw notFoundError() }
    state.mkdirImpl = () => {}
  })

  it('forwards the fastPut step(transferred, _, total) callback to onProgress', async () => {
    state.fastPut = vi.fn((localPath, remotePath, opts, done) => {
      opts.step(2048, 256 * 1024, 8192) // (transferred, chunkSize, total) per ssh2's fastPut contract
      done(null)
    })
    const onProgress = vi.fn()
    const job = { srcPath: 'C:\\watch\\f.mkv', filename: 'f.mkv', relPath: 'f.mkv', remoteDest: null }

    await createSftpBackend(CFG).transfer(job, onProgress)

    expect(onProgress).toHaveBeenCalledWith(2048, 8192)
  })
})
