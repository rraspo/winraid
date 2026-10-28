// On-disk cache of one captured frame per remote video, plus the media facts
// read off the same <video> element. The renderer decodes a video once,
// encodes the frame as WebP and hands it here; every later visit shows that
// still image instead of starting a decoder, which is what keeps scrolling a
// video folder smooth. Lives beside the image thumbnails under
// thumbs/{connId}/video/, keyed and freshness-checked the same way.

import { createHash } from 'crypto'
import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { decideCacheAction, stampCacheMtime } from './thumb-cache-freshness.js'

// A 320 px WebP frame is a few tens of KB; anything near this cap is not one.
const MAX_FRAME_BYTES = 1024 * 1024
const META_FIELDS = ['duration', 'width', 'height']

export function videoFramePaths(baseDir, connId, remotePath) {
  const hash = createHash('sha256').update(remotePath).digest('hex')
  const dir = join(baseDir, connId, 'video')
  return { dir, image: join(dir, `${hash}.webp`), meta: join(dir, `${hash}.json`) }
}

function isWebp(bytes) {
  return bytes.length > 12
    && bytes.subarray(0, 4).toString('latin1') === 'RIFF'
    && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
}

function cleanMeta(meta) {
  const clean = {}
  for (const field of META_FIELDS) {
    if (typeof meta?.[field] === 'number' && Number.isFinite(meta[field])) clean[field] = meta[field]
  }
  return clean
}

export function saveVideoFrame({ baseDir, connId, remotePath, modified, bytes, meta }) {
  // Without the remote mtime the frame could never prove itself fresh, so it
  // would never be served — refuse it rather than write dead weight.
  if (typeof modified !== 'number' || !Number.isFinite(modified)) return { ok: false, error: 'Missing modified time' }
  const buffer = Buffer.from(bytes ?? [])
  if (buffer.length > MAX_FRAME_BYTES) return { ok: false, error: 'Frame too large' }
  if (!isWebp(buffer)) return { ok: false, error: 'Not a WebP image' }

  const paths = videoFramePaths(baseDir, connId, remotePath)
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.meta, JSON.stringify(cleanMeta(meta)))
  writeFileSync(paths.image, buffer)
  stampCacheMtime(paths.image, modified)
  return { ok: true }
}

export function loadVideoFrame({ baseDir, connId, remotePath, modified }) {
  const paths = videoFramePaths(baseDir, connId, remotePath)
  let cachedMtime = null
  let cacheExists = true
  try {
    cachedMtime = statSync(paths.image).mtimeMs
  } catch (err) {
    cacheExists = err?.code !== 'ENOENT'
  }
  const requestedModified = typeof modified === 'number' && Number.isFinite(modified) ? modified : null
  if (decideCacheAction({ cacheExists, cachedMtime, requestedModified }) !== 'serve') return { hit: false }

  let bytes
  try { bytes = readFileSync(paths.image) } catch { return { hit: false } }
  let meta = {}
  try { meta = cleanMeta(JSON.parse(readFileSync(paths.meta, 'utf8'))) } catch { /* the frame alone is still worth showing */ }
  return { hit: true, bytes, meta }
}

export function removeVideoFrame({ baseDir, connId, remotePath }) {
  const paths = videoFramePaths(baseDir, connId, remotePath)
  rmSync(paths.image, { force: true })
  rmSync(paths.meta, { force: true })
}
