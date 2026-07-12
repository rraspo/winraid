// Local ffmpeg for the trim fallback: when the NAS has no ffmpeg, the cut
// runs on this PC instead (download the source, stream-copy locally, upload
// the result). The binary comes from, in order: a user-located path saved in
// config, a previously downloaded copy in userData, or the system PATH.

import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { parseFfmpegProbe, FFMPEG_WIN64_URL } from './video-trim.js'

export function downloadedFfmpegPath(dataDir) {
  return join(dataDir, 'ffmpeg', 'ffmpeg.exe')
}

// Validate a candidate by running `-version`; resolves { available, version? }.
export function validateFfmpegBinary(binPath) {
  return new Promise((resolve) => {
    let out = ''
    let proc
    try {
      proc = spawn(binPath, ['-version'], { windowsHide: true })
    } catch {
      return resolve({ available: false })
    }
    proc.on('error', () => resolve({ available: false }))
    proc.stdout?.on('data', (chunk) => { out += chunk })
    proc.on('close', (code) => {
      resolve(code === 0 ? parseFfmpegProbe(out) : { available: false })
    })
  })
}

// First working binary among: saved custom path, downloaded copy, PATH.
export async function findLocalFfmpeg({ dataDir, customPath }) {
  const downloaded = downloadedFfmpegPath(dataDir)
  const candidates = [
    customPath ? { path: customPath, source: 'custom' } : null,
    { path: downloaded, source: 'downloaded' },
    { path: 'ffmpeg', source: 'path' },
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate.source === 'downloaded' && !existsSync(candidate.path)) continue
    const probe = await validateFfmpegBinary(candidate.path)
    if (probe.available) return { ...candidate, version: probe.version }
  }
  return null
}

// Download the official static build, keep only ffmpeg.exe. Extraction uses
// PowerShell Expand-Archive - the app ships on Windows only, so it is always
// present and saves a zip dependency. `request` is electron net.request
// (injected so this module stays importable outside Electron).
export async function downloadFfmpeg({ dataDir, request, onProgress }) {
  const dir = join(dataDir, 'ffmpeg')
  const zipPath = join(dir, 'download.zip')
  const extractDir = join(dir, 'extract')
  mkdirSync(dir, { recursive: true })

  try {
    await new Promise((resolve, reject) => {
      const req = request(FFMPEG_WIN64_URL)
      req.on('response', (res) => {
        if (res.statusCode !== 200) return reject(new Error(`Download failed (HTTP ${res.statusCode})`))
        const total = Number(res.headers['content-length'] ?? 0)
        let received = 0
        const out = createWriteStream(zipPath)
        res.on('data', (chunk) => {
          received += chunk.length
          out.write(chunk)
          if (total) onProgress?.(received / total)
        })
        res.on('end', () => out.end(resolve))
        res.on('error', reject)
        out.on('error', reject)
      })
      req.on('error', reject)
      req.end()
    })

    rmSync(extractDir, { recursive: true, force: true })
    await new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', [
        '-NoProfile', '-Command',
        `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractDir}" -Force`,
      ], { windowsHide: true })
      proc.on('error', reject)
      proc.on('close', (code) => {
        code === 0 ? resolve() : reject(new Error('Could not extract the ffmpeg archive'))
      })
    })

    const root = readdirSync(extractDir).find((name) => existsSync(join(extractDir, name, 'bin', 'ffmpeg.exe')))
    if (!root) throw new Error('ffmpeg.exe not found in the downloaded archive')
    const finalPath = downloadedFfmpegPath(dataDir)
    renameSync(join(extractDir, root, 'bin', 'ffmpeg.exe'), finalPath)

    const probe = await validateFfmpegBinary(finalPath)
    if (!probe.available) throw new Error('The downloaded ffmpeg did not run')
    return { ok: true, path: finalPath, version: probe.version }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    rmSync(zipPath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}
