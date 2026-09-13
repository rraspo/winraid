// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { moveRemotePath } from './remote-move.js'

// The one remote move. `mv` over SSH comes first because it survives a
// cross-device move on a mergerfs union, where an SFTP rename fails with EXDEV;
// the SFTP rename is the fallback for shells that refuse exec.

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

function renameSftp(renameError = null) {
  return { rename: vi.fn((_src, _dst, cb) => cb(renameError)) }
}

const SRC = '/mnt/user/media/photos/a.jpg'
const DST = '/mnt/user/media/archive/a.jpg'

describe('moveRemotePath', () => {
  it('moves with a quoted mv over SSH when the shell allows it', async () => {
    const client = execClient()
    const sftp = renameSftp()
    const result = await moveRemotePath({ client, sftp, warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: true, via: 'ssh mv' })
    expect(client.exec.mock.calls[0][0]).toBe(`mv -- '${SRC}' '${DST}'`)
    expect(sftp.rename).not.toHaveBeenCalled()
  })

  it('falls back to an SFTP rename when mv exits non-zero', async () => {
    const warn = vi.fn()
    const sftp = renameSftp()
    const result = await moveRemotePath({ client: execClient({ exitCode: 1, stderr: 'not permitted' }), sftp, warn }, SRC, DST)
    expect(result).toEqual({ ok: true, via: 'sftp rename' })
    expect(sftp.rename).toHaveBeenCalledWith(SRC, DST, expect.any(Function))
    expect(warn.mock.calls[0][0]).toContain('not permitted')
  })

  it('falls back to an SFTP rename when exec itself is refused', async () => {
    const sftp = renameSftp()
    const result = await moveRemotePath({ client: execClient({ execError: new Error('exec denied') }), sftp, warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: true, via: 'sftp rename' })
  })

  it('uses the SFTP rename when there is no SSH client at all', async () => {
    const sftp = renameSftp()
    const result = await moveRemotePath({ client: null, sftp, warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: true, via: 'sftp rename' })
  })

  it('reports the rename error when both paths fail', async () => {
    const sftp = renameSftp(new Error('Failure'))
    const result = await moveRemotePath({ client: execClient({ exitCode: 1 }), sftp, warn: vi.fn() }, SRC, DST)
    expect(result).toEqual({ ok: false, error: 'Failure', via: 'sftp rename' })
  })
})
