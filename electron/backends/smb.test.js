// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stderr: '', error: undefined })),
}))

vi.mock('../logger.js', () => ({ log: vi.fn() }))

vi.mock('fs', () => ({
  createReadStream: vi.fn(() => {
    const reader = new EventEmitter()
    reader.destroy = vi.fn()
    reader.pipe = (target) => {
      // Simulate a successful pipe end — writer emits 'finish' on next tick.
      setImmediate(() => target.emit('finish'))
      return target
    }
    return reader
  }),
  createWriteStream: vi.fn(() => {
    const writer = new EventEmitter()
    writer.destroy = vi.fn()
    return writer
  }),
}))

vi.mock('fs/promises', () => ({
  access:  vi.fn(() => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))),
  mkdir:   vi.fn(() => Promise.resolve()),
  stat:    vi.fn(() => Promise.resolve({
    size:  1234,
    atime: new Date('2026-01-15T10:00:00Z'),
    mtime: new Date('2025-06-01T08:30:00Z'),
  })),
  utimes:  vi.fn(() => Promise.resolve()),
}))

import { access, stat, utimes } from 'fs/promises'
import { createWriteStream } from 'fs'
import { createSmbBackend } from './smb.js'

describe('SMB backend — preserves source timestamps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls utimes on the destination with the source file atime/mtime after copy', async () => {
    const backend = createSmbBackend({
      host:       'nas',
      share:      'media',
      remotePath: '\\photos',
    })
    const job = {
      srcPath:    'C:\\local\\photo.jpg',
      filename:   'photo.jpg',
      relPath:    'photo.jpg',
      remoteDest: null,
    }
    await backend.transfer(job, vi.fn())

    expect(utimes).toHaveBeenCalledTimes(1)
    const [destPath, atime, mtime] = utimes.mock.calls[0]
    expect(destPath).toMatch(/photo\.jpg$/)
    expect(atime).toEqual(new Date('2026-01-15T10:00:00Z'))
    expect(mtime).toEqual(new Date('2025-06-01T08:30:00Z'))
  })
})

// WR-01 acceptance: like SFTP, the SMB skip decision must be an integrity
// check — a destination that merely exists (e.g. a 0-byte leftover from an
// aborted copy) must not be treated as already-transferred.
describe('SMB skip integrity (WR-01)', () => {
  const LOCAL_SIZE = 4096
  const cfg = { host: 'nas.local', share: 'media', remotePath: '\\photos' }
  const job = {
    srcPath:    'C:\\local\\photo.jpg',
    filename:   'photo.jpg',
    relPath:    'photo.jpg',
    remoteDest: null,
  }

  // stat() must answer for both sides: UNC paths are the remote destination,
  // anything else is the local source.
  function statBySide(remoteSize) {
    stat.mockImplementation((path) => Promise.resolve({
      size:  String(path).startsWith('\\\\') ? remoteSize : LOCAL_SIZE,
      atime: new Date('2026-01-15T10:00:00Z'),
      mtime: new Date('2025-06-01T08:30:00Z'),
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('copies instead of skipping when the destination exists with a DIFFERENT size', async () => {
    access.mockResolvedValue(undefined) // destination exists...
    statBySide(0)                       // ...but is a 0-byte stub

    const result = await createSmbBackend(cfg).transfer({ ...job }, vi.fn())

    expect(result?.skipped).not.toBe(true)
    expect(createWriteStream).toHaveBeenCalledTimes(1)
  })

  it('skips only when the destination size matches the source size', async () => {
    access.mockResolvedValue(undefined)
    statBySide(LOCAL_SIZE)

    const result = await createSmbBackend(cfg).transfer({ ...job }, vi.fn())

    expect(result).toEqual({ skipped: true })
    expect(createWriteStream).not.toHaveBeenCalled()
  })
})
