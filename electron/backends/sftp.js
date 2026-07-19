import { Client } from 'ssh2'
import { readFile, stat } from 'fs/promises'
import { posix } from 'path'
import { homedir } from 'os'
import { log } from '../logger.js'
import { setSftpTimestamps } from '../sftp-helpers.js'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {{ host, port, username, password, keyPath, remotePath }} cfg
 * @returns {{ transfer(job, onProgress): Promise<void> }}
 */
export function createSftpBackend(cfg) {
  return { transfer: (job, onProgress) => transfer(cfg, job, onProgress) }
}

// ---------------------------------------------------------------------------
// Transfer entry point
// ---------------------------------------------------------------------------

async function transfer(cfg, job, onProgress) {
  const { conn, sftp } = await connect(cfg)

  try {
    const remotePath = buildRemotePath(job.remoteDest ?? cfg.remotePath, job.relPath)

    log('info', `SFTP checking remote: ${remotePath}`)
    // Skip only when the remote already holds a same-size copy. Existence alone
    // is not proof of a completed transfer: a truncated or zero-byte leftover
    // from an aborted run would otherwise count as done and, under move /
    // mirror_clean, cost us the only good local copy. Size equality is the
    // integrity rule (no checksum — we own both ends and never partial-resume).
    try {
      const remoteStat = await sftpStat(sftp, remotePath)
      const localStat = await stat(job.srcPath)
      if (remoteStat.size === localStat.size) {
        log('info', `SFTP skip (already transferred): ${job.filename} → ${remotePath}`)
        return { skipped: true }
      }
      log('info', `SFTP size mismatch, re-uploading: ${job.filename} (local ${localStat.size} vs remote ${remoteStat.size})`)
    } catch {
      // Absent (or unreadable) remote — proceed with upload
    }

    const remoteDir = posix.dirname(remotePath)
    await mkdirpRemote(sftp, remoteDir)
    await upload(sftp, job.srcPath, remotePath, onProgress)

    log('info', `SFTP transfer complete: ${job.filename} → ${remotePath}`)
  } finally {
    conn.end()
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

async function connect(cfg) {
  const connectOpts = {
    host:     cfg.host,
    port:     cfg.port ?? 22,
    username: cfg.username,
    // Retry aggressively once — the connection should be fast on LAN
    readyTimeout: 10_000,
  }

  if (cfg.keyPath) {
    const resolvedKeyPath = cfg.keyPath.replace(/^~/, homedir())
    connectOpts.privateKey = await readFile(resolvedKeyPath)
  } else {
    connectOpts.password = cfg.password
  }

  return new Promise((resolve, reject) => {
    const conn = new Client()

    conn.on('error', reject)

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err) }
        resolve({ conn, sftp })
      })
    })

    conn.connect(connectOpts)
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
