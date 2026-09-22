import { shQuote } from './shell-quote.js'

// The message shown for every copy failure that traces back to this
// connection having no server-side exec at all — an internal-sftp /
// ChrootDirectory account with no shell. Named once so the IPC layer and the
// renderer surface the identical, actionable wording rather than a generic
// "copy failed".
export const NO_EXEC_MESSAGE =
  'This connection cannot run commands on the server, so files cannot be copied here. Cut and paste still works on this connection.'

// The app's only remote copy: a server-side `cp -r` over SSH exec. SFTP has
// no copy primitive, so unlike moveRemotePath there is no second,
// always-available transport to fall back to — a connection that cannot exec
// fails the copy outright, with a message that names the actual reason
// rather than reading as a bug or a transient, retry-able failure.
//
// Resolves { ok, via } or { ok: false, error, via }; never rejects, so
// callers decide how to log and report the outcome.
export async function copyRemotePath({ client, warn }, srcPath, dstPath) {
  if (!client) {
    warn('no SSH client in pool, cannot copy — this connection has no server-side exec')
    return { ok: false, error: NO_EXEC_MESSAGE, via: 'ssh cp' }
  }

  return new Promise((resolve) => {
    client.exec(`cp -r -- ${shQuote(srcPath)} ${shQuote(dstPath)}`, (err, stream) => {
      if (err) {
        warn(`SSH exec error (${err.message}), this connection cannot run commands on the server`)
        return resolve({ ok: false, error: NO_EXEC_MESSAGE, via: 'ssh cp' })
      }
      stream.resume() // drain stdout so the SSH window doesn't stall
      const stderrChunks = []
      stream.stderr.on('data', (chunk) => stderrChunks.push(chunk))
      stream.on('error', (streamErr) => {
        warn(`SSH stream error (${streamErr.message}), this connection cannot run commands on the server`)
        resolve({ ok: false, error: NO_EXEC_MESSAGE, via: 'ssh cp' })
      })
      stream.on('close', (code) => {
        if (code === 0) return resolve({ ok: true, via: 'ssh cp' })
        const stderr = stderrChunks.join('').trim()
        warn(`cp exited ${code}${stderr ? ` — ${stderr}` : ''}`)
        resolve({ ok: false, error: stderr || `cp exited with code ${code}`, via: 'ssh cp' })
      })
    })
  })
}
