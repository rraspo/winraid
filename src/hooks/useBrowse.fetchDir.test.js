import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBrowse } from './useBrowse'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

const CONNECTIONS = [{
  id: 'conn1', name: 'NAS', type: 'sftp', icon: 'server',
  localFolder: 'C:\\sync', operation: 'copy', folderMode: 'mirror',
  extensions: [],
  sftp: { host: 'nas.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/media' },
  smb: { host: '', share: '', username: '', password: '', remotePath: '' },
}]

beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
  remoteFS.list.mockResolvedValue([{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }])
  remoteFS.tree.mockResolvedValue(undefined)
  window.winraid = {
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        return Promise.resolve(null)
      }),
      set: vi.fn(),
    },
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      readFile: vi.fn().mockResolvedValue({ ok: false, content: '' }),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
    },
    watcher: { list: vi.fn().mockResolvedValue({}) },
    queue: {
      list: vi.fn().mockResolvedValue([]),
      onUpdated: vi.fn().mockReturnValue(() => {}),
      onProgress: vi.fn().mockReturnValue(() => {}),
    },
  }
})

describe('useBrowse fetchDir — mode none', () => {
  it('calls remoteFS.list and sets entries', async () => {
    renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => expect(remoteFS.list).toHaveBeenCalledWith('conn1', expect.any(String)))
  })
})

describe('useBrowse fetchDir — mode stale', () => {
  it('uses cached snapshot and triggers background refresh via remoteFS.list', async () => {
    const cached = [{ name: 'cached.jpg', type: 'file', size: 0, modified: 0 }]
    // Return cached from getSnapshot so fetchDir enters the stale cache path
    remoteFS.getSnapshot.mockReturnValue(cached)
    // Make list resolve immediately but with fresh data
    const fresh = [{ name: 'fresh.jpg', type: 'file', size: 200, modified: 1 }]
    remoteFS.list.mockResolvedValue(fresh)

    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )

    // Eventually entries should be the fresh data (stale served first, then replaced by fresh)
    await waitFor(() => expect(result.current.entries).toEqual(fresh))
    // And the background refresh via remoteFS.list should have been called
    expect(remoteFS.list).toHaveBeenCalledWith('conn1', expect.any(String))
    // And remoteFS.invalidate should have been called before the refresh (stale-while-revalidate)
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', expect.any(String))
  })
})

describe('useBrowse fetchDir — out-of-order responses', () => {
  it('ignores a stale listing that resolves after the user has navigated away', async () => {
    // remoteFS.list returns a separately-controllable promise per path so we
    // can resolve them out of order (slow folder lands after a newer one).
    const deferred = {}
    function defer(path) {
      if (!deferred[path]) {
        let resolve
        const p = new Promise((r) => { resolve = r })
        deferred[path] = { p, resolve }
      }
      return deferred[path]
    }
    remoteFS.getSnapshot.mockReturnValue(null) // force the network path
    remoteFS.list.mockImplementation((_conn, path) => defer(path).p)

    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )

    // Initial load settles on the connection's remote root.
    await waitFor(() => expect(result.current.path).toBe('/media'))
    await act(async () => { defer('/media').resolve([{ name: 'root', type: 'dir', size: 0, modified: 0 }]) })

    // Navigate into A, then immediately into B. Both lists are now in flight.
    act(() => { result.current.navigate('/media/A') })
    act(() => { result.current.navigate('/media/B') })
    await waitFor(() => expect(result.current.path).toBe('/media/B'))

    const aData = [{ name: 'fileA', type: 'file', size: 0, modified: 0 }]
    const bData = [{ name: 'fileB', type: 'file', size: 0, modified: 0 }]

    // The current folder (B) resolves first, then the stale folder (A) resolves
    // late — exactly the race that swaps contents "a few seconds later".
    await act(async () => { defer('/media/B').resolve(bData) })
    await act(async () => { defer('/media/A').resolve(aData) })

    // The stale A response must NOT clobber the current B listing.
    expect(result.current.entries).toEqual(bData)
  })
})

describe('useBrowse fetchDir — mode tree', () => {
  it('returns cached snapshot and does NOT call remoteFS.list when hit', async () => {
    const cached = [{ name: 'cached.jpg', type: 'file', size: 0, modified: 0 }]
    remoteFS.getSnapshot.mockReturnValue(cached)
    window.winraid.config.get.mockImplementation((key) => {
      if (key === 'connections') return Promise.resolve(CONNECTIONS)
      if (key === 'browse') return Promise.resolve({ cacheMode: 'tree' })
      return Promise.resolve(null)
    })
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => expect(result.current.entries).toEqual(cached))
    expect(remoteFS.list).not.toHaveBeenCalled()
  })
})
