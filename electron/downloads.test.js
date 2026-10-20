// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, access, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDownloadManager } from './downloads.js'

// Contract under test — downloads run as background jobs.
//
// start() returns an id at once; the transfer runs on its own and reports
// through onUpdate snapshots { id, label, destination, state, filesDone,
// filesTotal, bytesDone, bytesTotal, currentFile, error }, where state goes
// preparing -> running -> done | failed | canceled. Totals are known before
// the first byte (a folder is walked first), so progress is a real fraction.
// cancel() stops mid-file: the partial file is removed, files already
// finished are kept, and nothing further starts.

const FILE_MODE = 0o100644
const DIR_MODE = 0o040755

// A fake SFTP session over an in-memory tree: { '/remote/path': Buffer }
// for files, { '/remote/dir': ['name', ...] } listings derived from it.
// Its fastGet reads in quarters through `this`, as ssh2's does, so a session
// view the code under test passes in is what gets read through. `gate` holds
// a file's second quarter until released; `failOn` fails it.
function makeSftp(files, { gate = null, failOn = null } = {}) {
  const children = (dir) => {
    const prefix = `${dir}/`
    const names = new Set()
    for (const path of Object.keys(files)) {
      if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0])
    }
    return [...names]
  }
  const isDir = (path) => !(path in files) && children(path).length > 0
  return {
    readdir(dir, cb) {
      cb(null, children(dir).map((name) => {
        const full = `${dir}/${name}`
        return isDir(full)
          ? { filename: name, attrs: { mode: DIR_MODE } }
          : { filename: name, attrs: { mode: FILE_MODE, size: files[full].length, mtime: 0 } }
      }))
    },
    stat(path, cb) {
      if (path in files) cb(null, { size: files[path].length, mode: FILE_MODE })
      else cb(new Error('No such file'))
    },
    outgoing: { state: 'open' },
    open(path, _flags, cb) { cb(null, { path }) },
    fstat(handle, cb) { cb(null, { size: files[handle.path].length }) },
    close(_handle, cb) { cb(null) },
    async read(handle, buffer, offset, length, position, cb) {
      if (position > 0 && failOn === handle.path) return cb(new Error('Connection lost'))
      if (position > 0 && gate?.path === handle.path) await gate.released
      const bytes = files[handle.path].subarray(position, position + length)
      bytes.copy(buffer, offset)
      cb(null, bytes.length, buffer, position)
    },
    fastGet(remotePath, localPath, opts, cb) {
      const source = this
      const fail = (err) => source.close(null, () => cb(err))
      source.open(remotePath, 'r', (_err, handle) => {
        source.fstat(handle, async (_e, { size }) => {
          await writeFile(localPath, '')
          const quarter = Math.ceil(size / 4)
          let position = 0
          const next = () => {
            if (position >= size) return source.close(handle, () => cb(null))
            const length = Math.min(quarter, size - position)
            source.read(handle, Buffer.alloc(length), 0, length, position, async (err, bytesRead, buffer) => {
              if (err) return fail(err)
              await appendFile(localPath, buffer.subarray(0, bytesRead))
              position += bytesRead
              opts.step?.(position, bytesRead, size)
              next()
            })
          }
          next()
        })
      })
    },
  }
}

function makeGate(path) {
  let release
  const released = new Promise((resolve) => { release = resolve })
  return { path, released, release }
}

function track() {
  const updates = []
  return {
    updates,
    onUpdate: (snapshot) => updates.push(snapshot),
    whenFinished: (id) => new Promise((resolve) => {
      const check = () => {
        const last = updates.filter((u) => u.id === id).at(-1)
        if (last && ['done', 'failed', 'canceled'].includes(last.state)) resolve(last)
        else setTimeout(check, 5)
      }
      check()
    }),
  }
}

let localRoot
beforeEach(async () => { localRoot = await mkdtemp(join(tmpdir(), 'winraid-dl-')) })
afterEach(async () => { await rm(localRoot, { recursive: true, force: true }) })

function setup(files, options) {
  const sftp = makeSftp(files, options)
  const tracker = track()
  const manager = createDownloadManager({
    getSftp: async () => sftp,
    onUpdate: tracker.onUpdate,
    progressIntervalMs: 0,
  })
  return { manager, ...tracker }
}

describe('createDownloadManager', () => {
  it('downloads a single file in the background and reports byte totals', async () => {
    const { manager, updates, whenFinished } = setup({ '/media/manual.pdf': Buffer.from('0123456789') })
    const localPath = join(localRoot, 'manual.pdf')

    const id = manager.start('atlas', [{ remotePath: '/media/manual.pdf', localPath, isDir: false }], localPath)
    expect(typeof id).toBe('string')

    const last = await whenFinished(id)
    expect(last).toMatchObject({
      state: 'done', label: 'manual.pdf', destination: localPath,
      filesDone: 1, filesTotal: 1, bytesDone: 10, bytesTotal: 10,
    })
    expect(updates.some((u) => u.state === 'running' && u.bytesDone > 0 && u.bytesDone < 10)).toBe(true)
    expect(await readFile(localPath, 'utf8')).toBe('0123456789')
  })

  it('walks a folder first so the totals cover every file', async () => {
    const { manager, updates, whenFinished } = setup({
      '/media/photos/a.jpg': Buffer.from('aaaa'),
      '/media/photos/trip/b.jpg': Buffer.from('bbbbbb'),
    })

    const id = manager.start('atlas', [{ remotePath: '/media/photos', localPath: localRoot, isDir: true }], join(localRoot, 'photos'))
    const last = await whenFinished(id)

    const firstRunning = updates.find((u) => u.state === 'running')
    expect(firstRunning).toMatchObject({ filesTotal: 2, bytesTotal: 10 })
    expect(last).toMatchObject({ state: 'done', label: 'photos', filesDone: 2, bytesDone: 10 })
    expect(await readFile(join(localRoot, 'photos', 'a.jpg'), 'utf8')).toBe('aaaa')
    expect(await readFile(join(localRoot, 'photos', 'trip', 'b.jpg'), 'utf8')).toBe('bbbbbb')
  })

  it('runs several selected entries as one job', async () => {
    const { manager, whenFinished } = setup({
      '/media/x.txt': Buffer.from('xx'),
      '/media/docs/y.txt': Buffer.from('yyy'),
    })

    const id = manager.start('atlas', [
      { remotePath: '/media/x.txt', localPath: join(localRoot, 'x.txt'), isDir: false },
      { remotePath: '/media/docs', localPath: localRoot, isDir: true },
    ], localRoot)
    const last = await whenFinished(id)

    expect(last).toMatchObject({ state: 'done', label: '2 items', filesTotal: 2, bytesTotal: 5 })
    expect(await readFile(join(localRoot, 'docs', 'y.txt'), 'utf8')).toBe('yyy')
  })

  it('cancels mid-file: removes the partial file, keeps finished ones, starts nothing else', async () => {
    const gate = makeGate('/media/set/2.bin')
    const { manager, updates, whenFinished } = setup({
      '/media/set/1.bin': Buffer.from('1111'),
      '/media/set/2.bin': Buffer.from('22222222'),
      '/media/set/3.bin': Buffer.from('3333'),
    }, { gate })

    const id = manager.start('atlas', [{ remotePath: '/media/set', localPath: localRoot, isDir: true }], join(localRoot, 'set'))
    await new Promise((resolve) => {
      const check = () => (updates.some((u) => u.currentFile === '2.bin' && u.bytesDone > 4) ? resolve() : setTimeout(check, 5))
      check()
    })
    expect(manager.cancel(id)).toBe(true)
    gate.release()
    const last = await whenFinished(id)

    expect(last).toMatchObject({ state: 'canceled', filesDone: 1 })
    expect(await readFile(join(localRoot, 'set', '1.bin'), 'utf8')).toBe('1111')
    await expect(access(join(localRoot, 'set', '2.bin'))).rejects.toThrow()
    await expect(access(join(localRoot, 'set', '3.bin'))).rejects.toThrow()
  })

  it('reports a failed transfer with its reason and removes the partial file', async () => {
    const { manager, whenFinished } = setup(
      { '/media/big.iso': Buffer.from('0123456789') },
      { failOn: '/media/big.iso' },
    )
    const localPath = join(localRoot, 'big.iso')

    const id = manager.start('atlas', [{ remotePath: '/media/big.iso', localPath, isDir: false }], localPath)
    const last = await whenFinished(id)

    expect(last).toMatchObject({ state: 'failed', error: 'Connection lost' })
    await expect(access(localPath)).rejects.toThrow()
  })

  it('fails cleanly when the connection is unavailable', async () => {
    const tracker = track()
    const manager = createDownloadManager({ getSftp: async () => null, onUpdate: tracker.onUpdate, progressIntervalMs: 0 })
    const id = manager.start('atlas', [{ remotePath: '/media/a', localPath: join(localRoot, 'a'), isDir: false }], localRoot)
    expect(await tracker.whenFinished(id)).toMatchObject({ state: 'failed', error: 'Connection unavailable' })
  })

  // The SFTP pool closes a session 30 s after its last touch; a transfer
  // that does not touch it while bytes flow loses its session mid-file.
  it('keeps the connection alive while bytes are flowing', async () => {
    const sftp = makeSftp({ '/media/a.bin': Buffer.from('abcdefgh') })
    const tracker = track()
    const touched = []
    const manager = createDownloadManager({
      getSftp: async () => sftp,
      touch: (connectionId) => touched.push(connectionId),
      onUpdate: tracker.onUpdate,
      progressIntervalMs: 0,
    })
    const id = manager.start('atlas', [{ remotePath: '/media/a.bin', localPath: join(localRoot, 'a.bin'), isDir: false }], localRoot)
    await tracker.whenFinished(id)
    expect(touched.length).toBeGreaterThanOrEqual(2)
    expect(new Set(touched)).toEqual(new Set(['atlas']))
  })

  it('lists the jobs it knows about, and cancel of an unknown id is a no-op', async () => {
    const { manager, whenFinished } = setup({ '/media/a.txt': Buffer.from('a') })
    const id = manager.start('atlas', [{ remotePath: '/media/a.txt', localPath: join(localRoot, 'a.txt'), isDir: false }], localRoot)
    await whenFinished(id)
    expect(manager.list().map((job) => job.id)).toContain(id)
    expect(manager.cancel('nope')).toBe(false)
  })
})
