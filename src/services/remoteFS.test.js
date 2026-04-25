import { describe, it, expect, vi, beforeEach } from 'vitest'

let remoteFS

beforeEach(async () => {
  vi.resetModules()
  global.window = global.window ?? {}
  window.winraid = {
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }] }),
      tree: vi.fn().mockResolvedValue({ ok: true, dirMap: { '/photos': [{ name: 'b.jpg', type: 'file', size: 200, modified: 0 }] } }),
    },
  }
  remoteFS = await import('./remoteFS.js')
})

describe('list()', () => {
  it('calls window.winraid.remote.list and returns entries', async () => {
    const entries = await remoteFS.list('conn1', '/photos')
    expect(window.winraid.remote.list).toHaveBeenCalledWith('conn1', '/photos')
    expect(entries).toEqual([{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }])
  })

  it('returns cached result without firing IPC again', async () => {
    await remoteFS.list('conn1', '/photos')
    await remoteFS.list('conn1', '/photos')
    expect(window.winraid.remote.list).toHaveBeenCalledTimes(1)
  })

  it('deduplicates in-flight requests', async () => {
    const [a, b] = await Promise.all([
      remoteFS.list('conn1', '/photos'),
      remoteFS.list('conn1', '/photos'),
    ])
    expect(window.winraid.remote.list).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('notifies subscribers after populating cache', async () => {
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    await remoteFS.list('conn1', '/photos')
    expect(listener).toHaveBeenCalled()
  })
})

describe('tree()', () => {
  it('populates cache for all paths in dirMap', async () => {
    await remoteFS.tree('conn1', '/photos')
    const snapshot = remoteFS.getSnapshot('conn1', '/photos')
    expect(snapshot).toEqual([{ name: 'b.jpg', type: 'file', size: 200, modified: 0 }])
  })

  it('notifies subscribers after populating', async () => {
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    await remoteFS.tree('conn1', '/photos')
    expect(listener).toHaveBeenCalled()
  })
})

describe('getSnapshot()', () => {
  it('returns null when key not in cache', () => {
    expect(remoteFS.getSnapshot('conn1', '/missing')).toBeNull()
  })

  it('returns cached entries after list()', async () => {
    await remoteFS.list('conn1', '/photos')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toEqual([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
    ])
  })

  it('returns the same array reference on repeated calls (stable reference)', async () => {
    await remoteFS.list('conn1', '/photos')
    const a = remoteFS.getSnapshot('conn1', '/photos')
    const b = remoteFS.getSnapshot('conn1', '/photos')
    expect(a).toBe(b)
  })
})

describe('update()', () => {
  it('applies updater and replaces cache entry', async () => {
    await remoteFS.list('conn1', '/photos')
    remoteFS.update('conn1', '/photos', (entries) => entries.filter((e) => e.name !== 'a.jpg'))
    expect(remoteFS.getSnapshot('conn1', '/photos')).toEqual([])
  })

  it('notifies subscribers', async () => {
    await remoteFS.list('conn1', '/photos')
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    remoteFS.update('conn1', '/photos', (e) => e)
    expect(listener).toHaveBeenCalled()
  })

  it('does nothing when key not in cache', () => {
    expect(() => remoteFS.update('conn1', '/missing', (e) => e)).not.toThrow()
  })
})

describe('invalidate()', () => {
  it('removes key from cache', async () => {
    await remoteFS.list('conn1', '/photos')
    remoteFS.invalidate('conn1', '/photos')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toBeNull()
  })

  it('notifies subscribers', async () => {
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    remoteFS.invalidate('conn1', '/photos')
    expect(listener).toHaveBeenCalled()
  })

  it('causes next list() to fire IPC again', async () => {
    await remoteFS.list('conn1', '/photos')
    remoteFS.invalidate('conn1', '/photos')
    await remoteFS.list('conn1', '/photos')
    expect(window.winraid.remote.list).toHaveBeenCalledTimes(2)
  })
})

describe('invalidateSubtree()', () => {
  it('removes all keys under the root path', async () => {
    window.winraid.remote.list
      .mockResolvedValueOnce({ ok: true, entries: [] })
      .mockResolvedValueOnce({ ok: true, entries: [] })
    await remoteFS.list('conn1', '/photos')
    await remoteFS.list('conn1', '/photos/2024')
    remoteFS.invalidateSubtree('conn1', '/photos')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toBeNull()
    expect(remoteFS.getSnapshot('conn1', '/photos/2024')).toBeNull()
  })
})

describe('invalidateConnection()', () => {
  it('removes all keys for the connection', async () => {
    window.winraid.remote.list
      .mockResolvedValueOnce({ ok: true, entries: [] })
      .mockResolvedValueOnce({ ok: true, entries: [] })
    await remoteFS.list('conn1', '/photos')
    await remoteFS.list('conn1', '/videos')
    remoteFS.invalidateConnection('conn1')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toBeNull()
    expect(remoteFS.getSnapshot('conn1', '/videos')).toBeNull()
  })
})

describe('subscribe()', () => {
  it('returns an unsubscribe function that stops notifications', async () => {
    const listener = vi.fn()
    const unsub = remoteFS.subscribe(listener)
    unsub()
    await remoteFS.list('conn1', '/photos')
    expect(listener).not.toHaveBeenCalled()
  })
})
