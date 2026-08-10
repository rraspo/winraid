import { stat } from 'fs/promises'
import { posix } from 'path'
import { log } from '../logger.js'
import { setSftpTimestamps } from '../sftp-helpers.js'
import { createSshConnection } from '../ssh-connection.js'
import { findAvailableRelPath } from '../duplicate-names.js'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {{ host, port, username, password, keyPath, remotePath }} cfg
 * @returns {{ transfer(job, onProgress, opts): Promise<object> }}
 */
export function createSftpBackend(cfg) {
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
  const { conn, sftp } = await connect(cfg)

  try {
    const remoteBase = job.remoteDest ?? cfg.remotePath
    // A persisted targetRelPath means this job already began an upload there —
    // whatever sits at that path is ours to resume, not a foreign duplicate.
    const attempted = job.targetRelPath != null
    let targetRel   = job.targetRelPath ?? job.relPath
    let remotePath  = buildRemotePath(remoteBase, targetRel)

    log('info', `SFTP checking remote: ${remotePath}`)
    let remoteStat = null
    try {
      remoteStat = await sftpStat(sftp, remotePath)
    } catch {
      // Absent (or unreadable) remote — proceed with upload
    }

    if (remoteStat) {
      if (attempted || !opts.protectPreexisting) {
        // Skip only when the remote already holds a same-size copy. Existence
        // alone is not proof of a completed transfer: a truncated leftover from
        // an aborted run would otherwise count as done. Size equality is the
        // integrity rule (no checksum — we own both ends and never partial-resume).
        let localSize = null
        try { localSize = (await stat(job.srcPath)).size } catch { /* upload() will surface ENOENT */ }
        if (localSize !== null && remoteStat.size === localSize) {
          log('info', `SFTP skip (already transferred): ${job.filename} → ${remotePath}`)
          return { skipped: true }
        }
        log('info', `SFTP size mismatch, re-uploading: ${job.filename} (local ${localSize} vs remote ${remoteStat.size})`)
      } else if (opts.renameDuplicates) {
        // Fresh job on a delete-local connection: the remote file is not ours,
        // regardless of size — land next to it under a free "name (n).ext".
        targetRel = await findAvailableRelPath(targetRel, async (rel) => {
          try { await sftpStat(sftp, buildRemotePath(remoteBase, rel)); return true } catch { return false }
        })
        remotePath = buildRemotePath(remoteBase, targetRel)
        log('info', `SFTP duplicate name, uploading as: ${targetRel}`)
      } else {
        log('info', `SFTP duplicate name conflict (not uploading): ${job.filename} → ${remotePath}`)
        return { conflict: true }
      }
    }

    await opts.onUploadStart?.(targetRel)
    const remoteDir = posix.dirname(remotePath)
    await mkdirpRemote(sftp, remoteDir)
    await upload(sftp, job.srcPath, remotePath, onProgress)

    log('info', `SFTP transfer complete: ${job.filename} → ${remotePath}`)
    return targetRel !== job.relPath ? { renamedTo: targetRel } : {}
  } finally {
    conn.end()
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

async function connect(cfg) {
  // Connection setup (config, tilde-expanded key, ready/error) is centralized
  // in ssh-connection.js; here we just open the SFTP channel on top.
  // pinHostKeys: false — this runs in the transfer worker, which must not write
  // the config (see createSshConnection). A key already pinned by the main
  // process is still enforced here.
  const conn = await createSshConnection(cfg, { readyTimeout: 10_000, pinHostKeys: false })

  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) { conn.end(); return reject(err) }
      resolve({ conn, sftp })
    })
  })
}

// ---------------------------------------------------------------------------
// Remote mkdir -p
// ---------------------------------------------------------------------------

/**
 * Recursively create `remotePath` on the SFTP server.
 * Checks existence with stat first to avoid spurious errors.
 */
async function mkdirpRemote(sftp, remotePath) {
  // Already at root — nothing to do
  if (!remotePath || remotePath === '/') return

  // If it already exists, we're done
  try {
    await sftpStat(sftp, remotePath)
    return
  } catch {
    // Does not exist — fall through to create it
  }

  // Ensure parent exists first
  const parent = posix.dirname(remotePath)
  if (parent !== remotePath) {
    await mkdirpRemote(sftp, parent)
  }

  try {
    await sftpMkdir(sftp, remotePath)
  } catch (err) {
    // Race condition: another process may have created it between our stat and mkdir
    if (err.code !== 4 && err.code !== 11) throw err
  }
}

// ---------------------------------------------------------------------------
// Upload with progress
// ---------------------------------------------------------------------------

async function upload(sftp, localPath, remotePath, onProgress) {
  const localStat = await stat(localPath)
  const totalBytes = localStat.size

  await new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, {
      // ssh2's fastPut step callback: (totalTransferred, chunkSize, totalSize)
      step: (transferred, _chunk, total) => {
        onProgress(transferred, total ?? totalBytes)
      },
      // Increase concurrency for LAN transfers — default 64 is conservative
      concurrency: 8,
      chunkSize: 256 * 1024,  // 256 KB chunks
    }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  // Preserve source file timestamps on the remote — fastPut otherwise leaves
  // the remote file with the server's "now" as mtime/atime.
  try {
    await setSftpTimestamps(sftp, remotePath, {
      atimeMs: localStat.atimeMs,
      mtimeMs: localStat.mtimeMs,
    })
  } catch (err) {
    log('warn', `SFTP setstat (timestamps) failed for ${remotePath}: ${err?.message ?? err}`)
  }
}

// ---------------------------------------------------------------------------
// Promisified ssh2 SFTP helpers
// ---------------------------------------------------------------------------


function sftpStat(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => err ? reject(err) : resolve(stats))
  })
}

function sftpMkdir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// ---------------------------------------------------------------------------
// Remote existence check — reusable session for batch lookups
// ---------------------------------------------------------------------------

/**
 * Open a persistent SFTP session for batch file-existence checks.
 * Call .exists(relPath) to check a single file, .close() when done.
 *
 * @param {{ host, port, username, password, keyPath, remotePath }} cfg
 * @returns {Promise<{ exists(relPath: string): Promise<boolean>, close(): void }>}
 */
export async function openRemoteChecker(cfg) {
  const base = cfg.remotePath.replace(/\\/g, '/')
  const { conn, sftp } = await connect(cfg)
  return {
    async exists(relPath) {
      const full = posix.join(base, relPath.replace(/\\/g, '/'))
      try {
        await sftpStat(sftp, full)
        return true
      } catch {
        return false
      }
    },
    close() { conn.end() },
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function buildRemotePath(remoteBase, relPath) {
  // Normalize to forward slashes and collapse duplicates
  return posix.join(remoteBase.replace(/\\/g, '/'), relPath.replace(/\\/g, '/'))
}
