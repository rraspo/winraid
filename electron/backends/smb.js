import { createReadStream, createWriteStream } from 'fs'
import { access, mkdir, stat, utimes } from 'fs/promises'
import { win32, dirname } from 'path'
import { spawnSync } from 'child_process'
import { log } from '../logger.js'
import { findAvailableRelPath } from '../duplicate-names.js'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {{ host, share, username, password, remotePath }} cfg
 * @returns {{ transfer(job, onProgress, opts): Promise<object> }}
 */
export function createSmbBackend(cfg) {
  return { transfer: (job, onProgress, opts) => transfer(cfg, job, onProgress, opts) }
}

// ---------------------------------------------------------------------------
// Transfer entry point
// ---------------------------------------------------------------------------

/**
 * @param {object} job
 * @param {(bytes: number, total: number) => void} onProgress
 * @param {{
 *   protectPreexisting?: boolean,  // delete-local connection: never skip past or overwrite a remote file this job didn't write
 *   renameDuplicates?: boolean,    // resolve name conflicts as "name (n).ext" instead of reporting them
 *   onUploadStart?: (targetRelPath: string) => void|Promise<void>,  // called with the final rel path before the first byte is written
 * }} [opts]
 * @returns {Promise<{ skipped?: true, conflict?: true, renamedTo?: string }>}
 */
async function transfer(cfg, job, onProgress, opts = {}) {
  const uncShare = `\\\\${cfg.host}\\${cfg.share}`

  // Authenticate if credentials are supplied.
  // net use caches credentials per session — subsequent calls are no-ops.
  if (cfg.username) {
    netUse(uncShare, cfg.username, cfg.password)
  }

  // Full destination path: \\host\share\remotePath\relPath
  const remoteBase = job.remoteDest ?? cfg.remotePath
  const toDestPath = (rel) => win32.join(uncShare, win32.join(remoteBase, rel.replace(/\//g, '\\')))

  // A persisted targetRelPath means this job already began a copy there —
  // whatever sits at that path is ours to resume, not a foreign duplicate.
  const attempted = job.targetRelPath != null
  let targetRel   = job.targetRelPath ?? job.relPath
  let destPath    = toDestPath(targetRel)

  // Stat the source up front — needed for the skip check below and reused for
  // the copy size and timestamp preservation, so we never stat it twice.
  const localStat = await stat(job.srcPath)

  let remoteStat = null
  try {
    await access(destPath)
    remoteStat = await stat(destPath)
  } catch {
    // Absent destination — proceed with copy
  }

  if (remoteStat) {
    if (attempted || !opts.protectPreexisting) {
      // Skip only when the destination already holds a same-size copy.
      // Existence alone is not proof of a completed transfer: a truncated
      // leftover from an aborted copy would otherwise count as done. Size
      // equality is the integrity rule (no checksum — we own both ends and
      // never partial-resume).
      if (remoteStat.size === localStat.size) {
        log('info', `SMB skip (already transferred): ${job.filename} → ${destPath}`)
        return { skipped: true }
      }
      log('info', `SMB size mismatch, re-copying: ${job.filename} (local ${localStat.size} vs remote ${remoteStat.size})`)
    } else if (opts.renameDuplicates) {
      // Fresh job on a delete-local connection: the destination file is not
      // ours, regardless of size — land next to it under a free "name (n).ext".
      targetRel = await findAvailableRelPath(targetRel, async (rel) => {
        try { await access(toDestPath(rel)); return true } catch { return false }
      })
      destPath = toDestPath(targetRel)
      log('info', `SMB duplicate name, copying as: ${targetRel}`)
    } else {
      log('info', `SMB duplicate name conflict (not copying): ${job.filename} → ${destPath}`)
      return { conflict: true }
    }
  }

  await opts.onUploadStart?.(targetRel)
  const destDir = dirname(destPath)
  await mkdir(destDir, { recursive: true })

  await copyWithProgress(job.srcPath, destPath, localStat.size, onProgress)

  // Preserve source timestamps — the stream copy otherwise leaves the
  // destination with the OS's "now" as mtime/atime.
  try {
    await utimes(destPath, localStat.atime, localStat.mtime)
  } catch (err) {
    log('warn', `SMB utimes failed for ${destPath}: ${err?.message ?? err}`)
  }

  log('info', `SMB transfer complete: ${job.filename} → ${destPath}`)
  return targetRel !== job.relPath ? { renamedTo: targetRel } : {}
}

// ---------------------------------------------------------------------------
// Stream-based copy (supports progress; fs.copyFile does not)
// ---------------------------------------------------------------------------

function copyWithProgress(src, dest, totalBytes, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = createReadStream(src)
    const writer = createWriteStream(dest)
    let transferred = 0

    reader.on('data', (chunk) => {
      transferred += chunk.length
      onProgress(transferred, totalBytes)
    })

    reader.on('error', (err) => { writer.destroy(); reject(err) })
    writer.on('error', (err) => { reader.destroy(); reject(err) })
    writer.on('finish', resolve)

    reader.pipe(writer)
  })
}

// ---------------------------------------------------------------------------
// Remote existence check — stateless, just probes a UNC path
// ---------------------------------------------------------------------------

/**
 * Open a checker for batch file-existence lookups on an SMB share.
 * Call .exists(relPath) to check a single file, .close() when done.
 *
 * @param {{ host, share, username, password, remotePath }} cfg
 * @returns {Promise<{ exists(relPath: string): Promise<boolean>, close(): void }>}
 */
export async function openRemoteChecker(cfg) {
  const uncShare = `\\\\${cfg.host}\\${cfg.share}`
  if (cfg.username) {
    netUse(uncShare, cfg.username, cfg.password)
  }
  const baseDir = win32.join(uncShare, cfg.remotePath)
  return {
    async exists(relPath) {
      const full = win32.join(baseDir, relPath.replace(/\//g, '\\'))
      try {
        await access(full)
        return true
      } catch {
        return false
      }
    },
    close() { /* no persistent resource for SMB */ },
  }
}

// ---------------------------------------------------------------------------
// net use — Windows SMB authentication
// ---------------------------------------------------------------------------

/**
 * Authenticates to a UNC share using `net use`.
 * Credentials are cached by Windows for the session after the first call.
 * Failures are logged as warnings and do not abort the transfer — the
 * subsequent file operation will fail with the real error if auth is wrong.
 *
 * Uses spawnSync with an explicit argument array so no shell is involved
 * and there is no possibility of argument-boundary injection via credentials.
 */
function netUse(uncShare, username, password) {
  const result = spawnSync(
    'net',
    ['use', uncShare, `/user:${username}`, password, '/persistent:no'],
    { windowsHide: true, timeout: 8_000, encoding: 'utf8' }
  )

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = result.stderr ?? ''
    // System error 85 = already connected — treat as success.
    const alreadyConnected = /System error 85/.test(stderr)
    if (!alreadyConnected) {
      log('warn', `net use warning: ${stderr.trim() || `exit code ${result.status}`}`)
    }
  } else {
    log('info', `SMB authenticated to ${uncShare}`)
  }
}
