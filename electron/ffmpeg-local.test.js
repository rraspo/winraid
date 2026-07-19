import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { downloadFfmpeg } from './ffmpeg-local.js'

describe('downloadFfmpeg cancellation', () => {
  it('aborts on signal, resolves canceled, and leaves no partial zip behind', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'wr-ffmpeg-'))
    try {
      const req = new EventEmitter()
      req.end = vi.fn()
      req.abort = vi.fn()
      const res = new EventEmitter()
      res.statusCode = 200
      res.headers = { 'content-length': '1000' }
      const controller = new AbortController()

      const promise = downloadFfmpeg({
        dataDir,
        request: () => req,
        onProgress: vi.fn(),
        signal: controller.signal,
      })

      req.emit('response', res)
      res.emit('data', Buffer.alloc(100))
      controller.abort()

      const result = await promise
      expect(result).toEqual({ ok: false, canceled: true })
      expect(req.abort).toHaveBeenCalled()
      expect(existsSync(join(dataDir, 'ffmpeg', 'download.zip'))).toBe(false)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('an already-aborted signal short-circuits before any request', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'wr-ffmpeg-'))
    try {
      const request = vi.fn()
      const controller = new AbortController()
      controller.abort()

      const result = await downloadFfmpeg({
        dataDir,
        request,
        onProgress: vi.fn(),
        signal: controller.signal,
      })
      expect(result).toEqual({ ok: false, canceled: true })
      expect(request).not.toHaveBeenCalled()
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
