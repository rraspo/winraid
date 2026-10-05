// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { copyRemotePath, NO_EXEC_MESSAGE } from './remote-copy.js'

// The app's only remote copy: a server-side `cp -r` over SSH exec. SFTP has
// no copy primitive, so unlike moveRemotePath there is no second transport to
// fall back to — a connection that cannot exec fails the copy outright, with
// a message naming the actual reason instead of reading as a bug or a
// transient, retry-able failure.

function execClient({ execError = null, exitCode = 0, stderr = '' } = {}) {
  return {
    exec: vi.fn((_cmd, cb) => {
      if (execError) return cb(execError)
      const stream = new EventEmitter()
      stream.resume = vi.fn()
      stream.stderr = new EventEmitter()
      cb(null, stream)
      if (stderr) stream.stderr.emit('data', Buffer.from(stderr))
      stream.emit('close', exitCode)
    }),
  }
}

const SRC = '/mnt/user/media/photos/a.jpg'
const DST = '/mnt/user/media/archive/a.jpg'

describe('copyRemotePath', () => {
  it('copies with a quoted cp -r over SSH when the shell allows it', async () => {
    const client = execClient()
    const result = await copyRemotePath({ client, warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: true, via: 'ssh cp' })
    expect(client.exec.mock.calls[0][0]).toBe(`cp -r -- '${SRC}' '${DST}'`)
  })

  it('reports the exact cp failure when the command runs but exits non-zero (stale source, permission failure)', async () => {
    const warn = vi.fn()
    const result = await copyRemotePath(
      { client: execClient({ exitCode: 1, stderr: "cp: cannot stat 'a.jpg': No such file or directory" }), warn },
      SRC, DST,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe("cp: cannot stat 'a.jpg': No such file or directory")
    expect(result.via).toBe('ssh cp')
    expect(result.error).not.toBe(NO_EXEC_MESSAGE)
  })

  it('reports a generic exit message when cp fails with no stderr', async () => {
    const result = await copyRemotePath({ client: execClient({ exitCode: 2 }), warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: false, error: 'cp exited with code 2', via: 'ssh cp' })
  })

  it('fails with the actionable no-exec message when exec itself is refused (restricted / internal-sftp shell)', async () => {
    const result = await copyRemotePath(
      { client: execClient({ execError: new Error('exec denied') }), warn: vi.fn() },
      SRC, DST,
    )
    expect(result).toEqual({ ok: false, error: NO_EXEC_MESSAGE, via: 'ssh cp' })
    expect(result.error).toMatch(/cannot run commands on the server/i)
    expect(result.error).toMatch(/cut and paste still works/i)
  })

  it('fails the same way when the exec stream itself errors mid-flight', async () => {
    const client = {
      exec: vi.fn((_cmd, cb) => {
        const stream = new EventEmitter()
        stream.resume = vi.fn()
        stream.stderr = new EventEmitter()
        cb(null, stream)
        stream.emit('error', new Error('connection lost'))
      }),
    }
    const result = await copyRemotePath({ client, warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: false, error: NO_EXEC_MESSAGE, via: 'ssh cp' })
  })

  it('fails with the no-exec message when there is no SSH client at all', async () => {
    const result = await copyRemotePath({ client: null, warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: false, error: NO_EXEC_MESSAGE, via: 'ssh cp' })
  })
})
