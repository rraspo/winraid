// @vitest-environment node
// SMB mirror of sftp.duplicates.test.js — same duplicate-name semantics for
// delete-local connections, over UNC paths instead of an SFTP session.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const LOCAL_SIZE = 1024
const SRC = 'C:\\watch\\movie.mkv'

const state = vi.hoisted(() => ({
  remoteSizes: new Map(), // full UNC dest path → size; absent → access/stat reject
  written: [],            // dest paths handed to createWriteStream
}))

vi.mock('fs', async () => {
  const { EventEmitter } = await import('events')
  return {
    createReadStream: vi.fn(() => {
      const reader = new EventEmitter()
      reader.pipe = (writer) => { setImmediate(() => writer.emit('finish')); return writer }
      return reader
    }),
    createWriteStream: vi.fn((destPath) => {
      state.written.push(destPath)
      const writer = new EventEmitter()
      writer.destroy = vi.fn()
      return writer
    }),
  }
})

vi.mock('fs/promises', () => ({
  access: vi.fn((p) => state.remoteSizes.has(p) ? Promise.resolve() : Promise.reject(new Error('ENOENT'))),
  stat: vi.fn((p) => {
    if (p === SRC) {
      return Promise.resolve({ size: LOCAL_SIZE, atime: new Date(1_700_000_000_000), mtime: new Date(1_700_000_000_000) })
    }
    if (state.remoteSizes.has(p)) return Promise.resolve({ size: state.remoteSizes.get(p) })
    return Promise.reject(new Error('ENOENT'))
  }),
  mkdir: vi.fn(() => Promise.resolve()),
  utimes: vi.fn(() => Promise.resolve()),
}))

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}))
vi.mock('../logger.js', () => ({ log: vi.fn() }))

import { createSmbBackend } from './smb.js'

const CFG = { host: 'nas.local', share: 'media', username: 'u', password: 'p', remotePath: 'incoming' }
const JOB = { srcPath: SRC, filename: 'movie.mkv', relPath: 'movie.mkv', remoteDest: null }
const DEST      = '\\\\nas.local\\media\\incoming\\movie.mkv'
const DEST_DUP1 = '\\\\nas.local\\media\\incoming\\movie (1).mkv'
const DEST_DUP2 = '\\\\nas.local\\media\\incoming\\movie (2).mkv'

function protectOpts(overrides = {}) {
  return { protectPreexisting: true, renameDuplicates: false, onUploadStart: vi.fn(), ...overrides }
}

describe('SMB duplicate handling for delete-local connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.remoteSizes = new Map()
    state.written = []
  })

  it('renames to "name (1).ext" when the target exists and renameDuplicates is on', async () => {
    state.remoteSizes.set(DEST, 555)
    const opts = protectOpts({ renameDuplicates: true })

    const result = await createSmbBackend(CFG).transfer({ ...JOB }, vi.fn(), opts)

    expect(result).toEqual({ renamedTo: 'movie (1).mkv' })
    expect(state.written).toEqual([DEST_DUP1])
    expect(opts.onUploadStart).toHaveBeenCalledWith('movie (1).mkv')
  })

  it('probes past taken counters to the first free name', async () => {
    state.remoteSizes.set(DEST, 555)
    state.remoteSizes.set(DEST_DUP1, 556)

    const result = await createSmbBackend(CFG).transfer({ ...JOB }, vi.fn(), protectOpts({ renameDuplicates: true }))

    expect(result).toEqual({ renamedTo: 'movie (2).mkv' })
    expect(state.written).toEqual([DEST_DUP2])
  })

  it('reports a conflict without copying when renameDuplicates is off, even at the same size', async () => {
    state.remoteSizes.set(DEST, LOCAL_SIZE)
    const opts = protectOpts()

    const result = await createSmbBackend(CFG).transfer({ ...JOB }, vi.fn(), opts)

    expect(result).toEqual({ conflict: true })
    expect(state.written).toEqual([])
    expect(opts.onUploadStart).not.toHaveBeenCalled()
  })

  it('copies normally at the original name when the target is free', async () => {
    const opts = protectOpts({ renameDuplicates: true })

    const result = await createSmbBackend(CFG).transfer({ ...JOB }, vi.fn(), opts)

    expect(result).toEqual({})
    expect(state.written).toEqual([DEST])
    expect(opts.onUploadStart).toHaveBeenCalledWith('movie.mkv')
  })

  it('skips when a retried job finds its own completed copy (same size at targetRelPath)', async () => {
    state.remoteSizes.set(DEST_DUP1, LOCAL_SIZE)
    const job = { ...JOB, targetRelPath: 'movie (1).mkv' }

    const result = await createSmbBackend(CFG).transfer(job, vi.fn(), protectOpts({ renameDuplicates: true }))

    expect(result).toEqual({ skipped: true })
    expect(state.written).toEqual([])
  })

  it('overwrites its own partial copy on retry (different size at targetRelPath)', async () => {
    state.remoteSizes.set(DEST_DUP1, 10)
    const job = { ...JOB, targetRelPath: 'movie (1).mkv' }

    const result = await createSmbBackend(CFG).transfer(job, vi.fn(), protectOpts({ renameDuplicates: true }))

    expect(result).toEqual({ renamedTo: 'movie (1).mkv' })
    expect(state.written).toEqual([DEST_DUP1])
  })

  it('keeps legacy skip semantics when protectPreexisting is off (copy connections)', async () => {
    state.remoteSizes.set(DEST, LOCAL_SIZE)

    const result = await createSmbBackend(CFG).transfer({ ...JOB }, vi.fn(), { protectPreexisting: false })

    expect(result).toEqual({ skipped: true })
    expect(state.written).toEqual([])
  })
})
