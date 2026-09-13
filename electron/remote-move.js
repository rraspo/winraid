import { shQuote } from './shell-quote.js'

// The only way this app moves or renames a remote path.
//
// SSH exec `mv` comes first: it handles a cross-device move on a mergerfs
// union, where a plain rename fails with EXDEV. Restricted shells that refuse
// exec, or an mv that fails, fall back to an SFTP rename.
//
// Resolves { ok, via } or { ok: false, error, via }; never rejects on a failed
// move, so callers decide how to log and report it.
export async function moveRemotePath({ client, sftp, warn }, srcPath, dstPath) {
  let moved = null
  if (client) {
    moved = await new Promise((resolve) => {
      client.exec(`mv -- ${shQuote(srcPath)} ${shQuote(dstPath)}`, (err, stream) => {
        if (err) {
          warn(`SSH exec error (${err.message}), falling back to SFTP rename`)
          return resolve(false)
        }
        stream.resume()  // drain stdout so the SSH window doesn't stall
        const stderrChunks = []
        stream.stderr.on('data', (chunk) => stderrChunks.push(chunk))
        stream.on('error', (streamErr) => {
          warn(`SSH stream error (${streamErr.message}), falling back to SFTP rename`)
          resolve(false)
        })
        stream.on('close', (code) => {
          if (code === 0) return resolve(true)
          const stderr = stderrChunks.join('').trim()
          warn(`mv exited ${code}${stderr ? ` — ${stderr}` : ''}, falling back to SFTP rename`)
          resolve(false)
        })
      })
    })
  } else {
    warn('no SSH client in pool, using SFTP rename')
  }
  if (moved) return { ok: true, via: 'ssh mv' }

  return new Promise((resolve) => {
    sftp.rename(srcPath, dstPath, (err) => {
      if (err) return resolve({ ok: false, error: err.message, via: 'sftp rename' })
      resolve({ ok: true, via: 'sftp rename' })
    })
  })
}
