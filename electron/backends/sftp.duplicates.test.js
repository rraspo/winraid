// @vitest-environment node
// Duplicate-name semantics for delete-local connections (move / mirror_clean).
// A remote file this job never wrote must not be silently skipped past or
// overwritten when the local source is about to be deleted:
//  - renameDuplicates ON  → upload as "name (n).ext" so every file lands
//  - renameDuplicates OFF → report a conflict; the worker errors the job and
//    keeps the local file
// A job that already started uploading (targetRelPath persisted) keeps the
// legacy resume semantics against its own target: same size → skip,
// different size → overwrite.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const LOCAL_SIZE = 1024

const state = vi.hoisted(() => ({
  remoteSizes: new Map(), // full remote path → size; absent → stat errors
  fastPut: null,
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/winraid-test' },
  safeStorage: { isEncryptionAvailable: () => false },
}))

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('events')
  class Client extends EventEmitter {
    connect() { setImmediate(() => this.emit('ready')) }
    sftp(callback) {
      callback(null, {
        stat: (remotePath, statCallback) => {
          if (state.remoteSizes.has(remotePath)) statCallback(null, { size: state.remoteSizes.get(remotePath) })
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

function protectOpts(overrides = {}) {
  return { protectPreexisting: true, renameDuplicates: false, onUploadStart: vi.fn(), ...overrides }
}

function uploadedPaths() {
  return state.fastPut.mock.calls.map((call) => call[1])
}

describe('SFTP duplicate handling for delete-local connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.fastPut = vi.fn((localPath, remotePath, opts, done) => done(null))
    state.remoteSizes = new Map()
  })

  it('renames to "name (1).ext" when the target exists and renameDuplicates is on', async () => {
    state.remoteSizes.set('/backups/movie.mkv', 555)
    const opts = protectOpts({ renameDuplicates: true })

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), opts)

    expect(result).toEqual({ renamedTo: 'movie (1).mkv' })
    expect(uploadedPaths()).toEqual(['/backups/movie (1).mkv'])
    expect(opts.onUploadStart).toHaveBeenCalledWith('movie (1).mkv')
  })

  it('probes past taken counters to the first free name', async () => {
    state.remoteSizes.set('/backups/movie.mkv', 555)
    state.remoteSizes.set('/backups/movie (1).mkv', 556)
    state.remoteSizes.set('/backups/movie (2).mkv', 557)

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), protectOpts({ renameDuplicates: true }))

    expect(result).toEqual({ renamedTo: 'movie (3).mkv' })
    expect(uploadedPaths()).toEqual(['/backups/movie (3).mkv'])
  })

  it('renames even when the remote file has the SAME size — a fresh job never wrote it', async () => {
    state.remoteSizes.set('/backups/movie.mkv', LOCAL_SIZE)

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), protectOpts({ renameDuplicates: true }))

    expect(result).toEqual({ renamedTo: 'movie (1).mkv' })
  })

  it('reports a conflict without uploading when renameDuplicates is off', async () => {
    state.remoteSizes.set('/backups/movie.mkv', 555)
    const opts = protectOpts()

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), opts)

    expect(result).toEqual({ conflict: true })
    expect(state.fastPut).not.toHaveBeenCalled()
    expect(opts.onUploadStart).not.toHaveBeenCalled()
  })

  it('reports a conflict even for a same-size remote file — never silently skips a fresh job', async () => {
    state.remoteSizes.set('/backups/movie.mkv', LOCAL_SIZE)

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), protectOpts())

    expect(result).toEqual({ conflict: true })
    expect(state.fastPut).not.toHaveBeenCalled()
  })

  it('uploads normally at the original name when the target is free', async () => {
    const opts = protectOpts({ renameDuplicates: true })

    const result = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), opts)

    expect(result).toEqual({})
    expect(uploadedPaths()).toEqual(['/backups/movie.mkv'])
    expect(opts.onUploadStart).toHaveBeenCalledWith('movie.mkv')
  })

  it('skips when a retried job finds its own completed upload (same size at targetRelPath)', async () => {
    state.remoteSizes.set('/backups/movie (1).mkv', LOCAL_SIZE)
    const job = { ...JOB, targetRelPath: 'movie (1).mkv' }

    const result = await createSftpBackend(CFG).transfer(job, vi.fn(), protectOpts({ renameDuplicates: true }))

    expect(result).toEqual({ skipped: true })
    expect(state.fastPut).not.toHaveBeenCalled()
  })

  it('overwrites its own partial upload on retry (different size at targetRelPath)', async () => {
    state.remoteSizes.set('/backups/movie (1).mkv', 10) // truncated leftover from the aborted attempt
    const job = { ...JOB, targetRelPath: 'movie (1).mkv' }

    const result = await createSftpBackend(CFG).transfer(job, vi.fn(), protectOpts({ renameDuplicates: true }))

    expect(result).toEqual({ renamedTo: 'movie (1).mkv' })
    expect(uploadedPaths()).toEqual(['/backups/movie (1).mkv'])
  })

  it('keeps legacy skip/overwrite semantics when protectPreexisting is off (copy connections)', async () => {
    state.remoteSizes.set('/backups/movie.mkv', LOCAL_SIZE)

    const sameSize = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), { protectPreexisting: false })
    expect(sameSize).toEqual({ skipped: true })

    state.remoteSizes.set('/backups/movie.mkv', 999)
    const differentSize = await createSftpBackend(CFG).transfer({ ...JOB }, vi.fn(), { protectPreexisting: false })
    expect(differentSize).toEqual({})
    expect(uploadedPaths()).toEqual(['/backups/movie.mkv'])
  })
})
