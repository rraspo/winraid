import { createReadStream, createWriteStream } from 'fs'
import { mkdir, stat } from 'fs/promises'
import { win32, dirname } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { log } from '../logger.js'

const execAsync = promisify(exec)

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
    await netUse(uncShare, cfg.username, cfg.password)
  }

  // Build full destination path: \\host\share\remotePath\relPath
  const subPath  = win32.join(cfg.remotePath, job.relPath.replace(/\//g, '\\'))
  const destPath = win32.join(uncShare, subPath)
  const destDir  = dirname(destPath)

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
// net use — Windows SMB authentication
// ---------------------------------------------------------------------------

/**
 * Authenticates to a UNC share using `net use`.
 * Credentials are cached by Windows for the session after the first call.
 * Failures are logged as warnings and do not abort the transfer — the
 * subsequent file operation will fail with the real error if auth is wrong.
 */
async function netUse(uncShare, username, password) {
  // Sanitize: reject credentials containing shell metacharacters
  for (const val of [uncShare, username, password]) {
    if (/[&|<>\n\r]/.test(val)) {
      throw new Error('SMB config contains invalid characters.')
    }
  }

  try {
    await execAsync(
      `net use "${uncShare}" /user:"${username}" "${password}" /persistent:no`,
      { windowsHide: true, timeout: 8_000 }
    )
    log('info', `SMB authenticated to ${uncShare}`)
  } catch (err) {
    // Error 2 = already connected with different credentials (update them).
    // Error 85 = already connected — fine, carry on.
    const alreadyConnected = /System error 85/.test(err.stderr ?? '')
    if (!alreadyConnected) {
      log('warn', `net use warning: ${err.stderr?.trim() ?? err.message}`)
    }
  }
}
