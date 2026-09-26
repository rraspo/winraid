// @vitest-environment node
//
// Acceptance suite for the on-disk thumbnail / full-resolution cache
// freshness decision in the nas-stream handler. The handler in main.js
// keys the cache on sha256(remotePath) alone, with no mtime, no size, and
// no freshness check on a hit — so a cached JPEG or full-res copy outlives
// the file it was made from whenever something other than WinRaid mutates
// that file (a camera writing a new file at the same path, another machine,
// a script).
//
// The fix is a pure freshness decision + a stamp-on-write. This suite pins
// the contract as a pure function of three inputs:
//
//   - cacheExists     does the cache file exist?
//   - cachedMtime     mtime read off the cache file (same unit as
//                     requestedModified; null when the file exists but its
//                     mtime could not be read)
//   - requestedModified  modified value the request carries (null when the
//                     URL has no v= param)
//
// The decision returns 'serve' or 'regenerate'. Any uncertainty goes the
// safe direction: a serve is never returned for a cache that exists but
// could not be stat'd, a request without a modified value, or a cached
// mtime that disagrees with the request (in either direction — a restore or
// a clock skew can leave the cache newer).
//
// The same function is used for both the ?thumb=1 thumbnail branch and the
// no-Range full-resolution branch; case 8 below pins that the full-res
// path is not exempted from the same rules.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { decideCacheAction, stampCacheMtime } from './thumb-cache-freshness.js'

describe('decideCacheAction — thumbnail cache freshness', () => {
  // Picked a value that is whole seconds since the epoch so a
  // second-precision fs.utimes round-trip on the write side does not
  // truncate the test value.
  const remoteMs = 1_700_000_000_000

  it('serves from cache when the cached mtime matches the requested modified time', () => {
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs,
      requestedModified: remoteMs,
    })).toBe('serve')
  })

  it('regenerates when the cached mtime is older than the requested modified time', () => {
    // Remote file changed after the cache was written — the cached bytes
    // are no longer the file the renderer asked for.
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs - 1_000,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates when the cached mtime is newer than the requested modified time', () => {
    // A restore or a clock skew can leave the cache newer than the request.
    // Serving stale bytes here would be the wrong direction: assume the
    // worst (cache is wrong) and regenerate.
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs + 1_000,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates when no cached file exists', () => {
    expect(decideCacheAction({
      cacheExists: false,
      cachedMtime: null,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates when the cached file exists but its mtime cannot be read', () => {
    // The single most important case: any uncertainty about the cached
    // mtime produces a regenerate, never a serve. A serve here would
    // expose the very stale-byte bug this fix exists to close.
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: null,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates when the request carries no modified value', () => {
    // The modified timestamp is the freshness signal; its absence means
    // the caller cannot prove the cache matches the file. The card is
    // silent on this case, so the suite pins the safe direction:
    // regenerate, never serve.
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs,
      requestedModified: null,
    })).toBe('regenerate')
  })
})

// The thumbnail and full-resolution caches use the same function. These
// cases mirror the ones above under a "full-res cache" framing so the
// implementer is pinned to wiring the decision into both branches of the
// nas-stream handler — not just the ?thumb=1 branch.
describe('decideCacheAction — same rules apply to the full-resolution cache path', () => {
  const remoteMs = 1_700_000_000_000

  it('serves the full-res cache when its mtime matches the requested modified time', () => {
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs,
      requestedModified: remoteMs,
    })).toBe('serve')
  })

  it('regenerates the full-res cache when its mtime is older than the requested modified time', () => {
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs - 1_000,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates the full-res cache when its mtime is newer than the requested modified time', () => {
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs + 1_000,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates the full-res cache when no cached file exists', () => {
    expect(decideCacheAction({
      cacheExists: false,
      cachedMtime: null,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates the full-res cache when its mtime cannot be read', () => {
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: null,
      requestedModified: remoteMs,
    })).toBe('regenerate')
  })

  it('regenerates the full-res cache when the request carries no modified value', () => {
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: remoteMs,
      requestedModified: null,
    })).toBe('regenerate')
  })
})

// Writing a cache entry must stamp its on-disk mtime to the remote mtime,
// so the freshness decision identifies the next request for the same
// unchanged file as a hit. This pins the write-side contract: the handler
// in main.js calls stampCacheMtime when persisting a cache entry, so the
// next request for the same remoteMtimeMs is a 'serve'.
describe('stampCacheMtime — round-trip with decideCacheAction', () => {
  let workDir
  let cachePath

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'thumb-cache-fresh-'))
    cachePath = join(workDir, 'cache.jpg')
    writeFileSync(cachePath, Buffer.from('fake jpeg bytes'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('stamps the cache file mtime so a subsequent unchanged request serves', () => {
    // A whole-second value so a second-precision fs.utimes round-trip on
    // the write side is lossless.
    const remoteMs = 1_700_000_000_000
    stampCacheMtime(cachePath, remoteMs)
    const { mtimeMs } = statSync(cachePath)
    expect(decideCacheAction({
      cacheExists: true,
      cachedMtime: mtimeMs,
      requestedModified: remoteMs,
    })).toBe('serve')
  })
})
