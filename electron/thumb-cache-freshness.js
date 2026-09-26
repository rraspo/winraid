// Freshness decision for the on-disk thumbnail / full-resolution cache used
// by the nas-stream:// protocol handler. Extracted as a pure module (the
// established pattern for main.js seams — see remote-list.js,
// remote-entry-info.js, config-allowlist.js) so the decision is testable
// without an SSH connection or a running app.
//
// The cache used to key on sha256(remotePath) alone, with no freshness
// check on a hit: a cached copy would outlive the remote file it was made
// from whenever something other than WinRaid mutated that path (a camera
// writing a new file at the same name, another machine, a script). This
// module is the fix — any uncertainty about whether the cache still
// matches the remote file resolves to 'regenerate', never 'serve'.

import { utimesSync } from 'fs'

/**
 * @param {object} input
 * @param {boolean} input.cacheExists — does the cache file exist on disk?
 * @param {number|null} input.cachedMtime — mtime read off the cache file, in
 *   the same unit as requestedModified; null when the file exists but its
 *   mtime could not be read.
 * @param {number|null} input.requestedModified — the modified time the
 *   request carries; null when the URL has no v= param.
 * @returns {'serve'|'regenerate'}
 */
export function decideCacheAction({ cacheExists, cachedMtime, requestedModified }) {
  if (!cacheExists) return 'regenerate'
  // A cache that can't prove its own freshness, or a request that can't
  // state what it expects, is not a hit — no signal is a stale signal.
  if (cachedMtime === null || requestedModified === null) return 'regenerate'
  // Newer or older, either direction means the bytes on disk are not the
  // file the request describes.
  if (cachedMtime !== requestedModified) return 'regenerate'
  return 'serve'
}

/**
 * Stamps a written cache file's mtime with the remote file's modified time
 * (milliseconds since epoch) so the next request for that same, unchanged
 * remote mtime is recognized as a hit by decideCacheAction.
 *
 * @param {string} cachePath
 * @param {number} remoteMtimeMs
 */
export function stampCacheMtime(cachePath, remoteMtimeMs) {
  const stamp = new Date(remoteMtimeMs)
  utimesSync(cachePath, stamp, stamp)
}
