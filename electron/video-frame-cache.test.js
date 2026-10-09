import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { saveVideoFrame, loadVideoFrame, removeVideoFrame, videoFramePaths } from './video-frame-cache.js'

// Contract under test — the on-disk cache of one captured frame per remote
// video (WebP, encoded by the renderer) plus the media facts read off the
// same <video> element, so a revisited video shows a still image instead of
// starting a decoder. A hit is only served for the exact remote mtime it was
// captured from; anything uncertain is a miss.

// "RIFF" <size> "WEBP" — the container header every WebP starts with.
function webp(extra = 16) {
  const bytes = new Uint8Array(12 + extra)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  return bytes
}

const META = { duration: 125.5, width: 1920, height: 1080 }
const MODIFIED = 1_760_000_000_000

let baseDir
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'winraid-vframe-')) })
afterEach(() => { rmSync(baseDir, { recursive: true, force: true }) })

const target = { connId: 'c1', remotePath: '/media/clip.mp4' }

describe('video frame cache', () => {
  it('serves a saved frame and its media facts back for the same remote mtime', () => {
    expect(saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: META })).toEqual({ ok: true })

    const hit = loadVideoFrame({ baseDir, ...target, modified: MODIFIED })
    expect(hit.hit).toBe(true)
    expect(Buffer.from(hit.bytes).equals(Buffer.from(webp()))).toBe(true)
    expect(hit.meta).toEqual(META)
  })

  it('is a miss when the remote file has changed since the frame was captured', () => {
    saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: META })
    expect(loadVideoFrame({ baseDir, ...target, modified: MODIFIED + 1000 })).toEqual({ hit: false })
  })

  it('is a miss when nothing was saved, or the caller cannot state the mtime', () => {
    expect(loadVideoFrame({ baseDir, ...target, modified: MODIFIED })).toEqual({ hit: false })
    saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: META })
    expect(loadVideoFrame({ baseDir, ...target, modified: null })).toEqual({ hit: false })
  })

  it('keeps frames of different paths and connections apart', () => {
    saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: META })
    expect(loadVideoFrame({ baseDir, connId: 'c2', remotePath: target.remotePath, modified: MODIFIED })).toEqual({ hit: false })
    expect(loadVideoFrame({ baseDir, connId: 'c1', remotePath: '/media/other.mp4', modified: MODIFIED })).toEqual({ hit: false })
  })

  it('refuses bytes that are not a WebP image', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: png, meta: META }).ok).toBe(false)
    expect(existsSync(videoFramePaths(baseDir, target.connId, target.remotePath).image)).toBe(false)
  })

  it('refuses an oversized frame', () => {
    const huge = webp(2 * 1024 * 1024)
    expect(saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: huge, meta: META }).ok).toBe(false)
  })

  it('refuses a save without a usable remote mtime, since it could never be served', () => {
    expect(saveVideoFrame({ baseDir, ...target, modified: null, bytes: webp(), meta: META }).ok).toBe(false)
  })

  it('keeps only finite numeric media facts', () => {
    saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: { duration: Infinity, width: 640, height: '480', extra: 'x' } })
    expect(loadVideoFrame({ baseDir, ...target, modified: MODIFIED }).meta).toEqual({ width: 640 })
  })

  it('serves the frame with empty facts when the facts file is unreadable', () => {
    saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: META })
    writeFileSync(videoFramePaths(baseDir, target.connId, target.remotePath).meta, '{not json')
    const hit = loadVideoFrame({ baseDir, ...target, modified: MODIFIED })
    expect(hit.hit).toBe(true)
    expect(hit.meta).toEqual({})
  })

  it('forgets a frame on removal', () => {
    saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: META })
    removeVideoFrame({ baseDir, ...target })
    expect(loadVideoFrame({ baseDir, ...target, modified: MODIFIED })).toEqual({ hit: false })
    expect(existsSync(videoFramePaths(baseDir, target.connId, target.remotePath).meta)).toBe(false)
  })

  it('stores frames as .webp under the connection folder', () => {
    const { image } = videoFramePaths(baseDir, 'c1', '/media/clip.mp4')
    expect(image.startsWith(join(baseDir, 'c1', 'video'))).toBe(true)
    expect(image.endsWith('.webp')).toBe(true)
    saveVideoFrame({ baseDir, ...target, modified: MODIFIED, bytes: webp(), meta: META })
    expect(readFileSync(image).subarray(8, 12).toString()).toBe('WEBP')
  })
})
