import { createReadStream, createWriteStream } from 'fs'
import { access, mkdir, stat } from 'fs/promises'
import { win32, dirname } from 'path'
import { spawnSync } from 'child_process'
import { log } from '../logger.js'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {{ host, share, username, password, remotePath }} cfg
 * @returns {{ transfer(job, onProgress): Promise<void> }}
 */
export function createSmbBackend(cfg) {
  return { transfer: (job, onProgress) => transfer(cfg, job, onProgress) }
}

// ---------------------------------------------------------------------------
// Transfer entry point
// ---------------------------------------------------------------------------

async function transfer(cfg, job, onProgress) {
  const uncShare = `\\\\${cfg.host}\\${cfg.share}`

  // Authenticate if credentials are supplied.
  // net use caches credentials per session — subsequent calls are no-ops.
  if (cfg.username) {
    netUse(uncShare, cfg.username, cfg.password)
  }

  // Build full destination path: \\host\share\remotePath\relPath
  const subPath  = win32.join(job.remoteDest ?? cfg.remotePath, job.relPath.replace(/\//g, '\\'))
  const destPath = win32.join(uncShare, subPath)

  try {
    await access(destPath)
    log('info', `SMB skip (exists on remote): ${job.filename} → ${destPath}`)
    return { skipped: true }
  } catch {
    // Does not exist — proceed with copy
  }

  const destDir = dirname(destPath)
  await mkdir(destDir, { recursive: true })

  const { size: totalBytes } = await stat(job.srcPath)
  await copyWithProgress(job.srcPath, destPath, totalBytes, onProgress)

  log('info', `SMB transfer complete: ${job.filename} → ${destPath}`)
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
