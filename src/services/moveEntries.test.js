import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { moveEntries } from './moveEntries'
import * as remoteFS from './remoteFS'
import * as moveProgress from './moveProgress'

const A = { name: 'a.txt', entryPath: '/foo/a.txt' }
const B = { name: 'b.txt', entryPath: '/foo/b.txt' }
const SUB = { name: 'sub', entryPath: '/foo/sub' }

beforeEach(() => {
  window.winraid = { remote: { move: vi.fn().mockResolvedValue({ ok: true }) } }
})

afterEach(() => moveProgress.clearAll())

describe('moveEntries', () => {
  it('shows the move while it runs, item by item, and clears it after', async () => {
    const seen = []
    window.winraid.remote.move.mockImplementation(async () => {
      seen.push(moveProgress.getSnapshot().map(({ connectionId, total, done, name }) => ({ connectionId, total, done, name })))
      return { ok: true }
    })
    const onProgress = vi.fn()
    await moveEntries('conn-1', [A, B], '/bar', { onProgress })
    expect(seen).toEqual([
      [{ connectionId: 'conn-1', total: 2, done: 0, name: 'a.txt' }],
      [{ connectionId: 'conn-1', total: 2, done: 1, name: 'b.txt' }],
    ])
    expect(onProgress.mock.calls).toEqual([[{ done: 0, total: 2, name: 'a.txt' }], [{ done: 1, total: 2, name: 'b.txt' }]])
    expect(moveProgress.getSnapshot()).toEqual([])
  })

  it('clears the move even when the NAS call throws', async () => {
    window.winraid.remote.move.mockRejectedValue(new Error('gone'))
    await expect(moveEntries('conn-1', [A], '/bar')).rejects.toThrow('gone')
    expect(moveProgress.getSnapshot()).toEqual([])
  })

  it('registers nothing for a drop that moves nothing', async () => {
    const listener = vi.fn()
    const unsubscribe = moveProgress.subscribe(listener)
    await moveEntries('conn-1', [A], '/foo')
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })

  it('moves every entry into the target folder and labels the result', async () => {
    const result = await moveEntries('conn-1', [A, B], '/bar')
    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/foo/a.txt', '/bar/a.txt')
    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/foo/b.txt', '/bar/b.txt')
    expect(result).toEqual({ ok: true, msg: 'Moved 2 items' })
  })

  it('joins onto the root without a double slash', async () => {
    await moveEntries('conn-1', [A], '/')
    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/foo/a.txt', '/a.txt')
  })

  it('returns null and moves nothing when every entry already lives in the target', async () => {
    expect(await moveEntries('conn-1', [A, B], '/foo')).toBeNull()
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })

  it('returns null and moves nothing when the target is a dragged folder or inside one', async () => {
    expect(await moveEntries('conn-1', [A, SUB], '/foo/sub')).toBeNull()
    expect(await moveEntries('conn-1', [A, SUB], '/foo/sub/deeper')).toBeNull()
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })

  it('reports the first failure', async () => {
    window.winraid.remote.move
      .mockResolvedValueOnce({ ok: false, error: 'Permission denied' })
      .mockResolvedValueOnce({ ok: false, error: 'Later error' })
    expect(await moveEntries('conn-1', [A, B], '/bar')).toEqual({ ok: false, msg: 'Permission denied' })
  })

  it('tells every view showing the source or target folder that it changed', async () => {
    const listener = vi.fn()
    const unsubscribe = remoteFS.onFoldersChanged(listener)
    await moveEntries('conn-1', [A], '/bar')
    unsubscribe()
    expect(listener).toHaveBeenCalledWith('conn-1', expect.arrayContaining(['/foo', '/bar']))
  })
})
