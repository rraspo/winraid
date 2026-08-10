import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDirFetch } from './useDirFetch'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

const CONNECTIONS = [{
  id: 'conn1', name: 'NAS', type: 'sftp',
  sftp: { host: 'nas.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/media' },
  smb: { host: '', share: '', username: '', password: '', remotePath: '' },
}]

let setStatusSpy
let setHighlightFileSpy
let cacheModeRef

// Build the argument object the hook is composed with, defaulting every knob to
// the values useBrowse holds at mount so each test only states what it varies.
// cacheModeRef is a per-test singleton because useBrowse passes a useRef whose
// identity is stable across renders — a fresh object here would churn fetchDir.
function makeArgs(overrides = {}) {
  return {
    selectedId:       'conn1',
    path:             '/media',
    connections:      CONNECTIONS,
    cacheModeRef,
    setStatus:        setStatusSpy,
    setHighlightFile: setHighlightFileSpy,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setStatusSpy = vi.fn()
  setHighlightFileSpy = vi.fn()
  cacheModeRef = { current: 'stale' }
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
  remoteFS.list.mockResolvedValue([])
  remoteFS.tree.mockResolvedValue(undefined)
  window.winraid = {
    queue: { onUpdated: vi.fn().mockReturnValue(() => {}) },
  }
})

describe('useDirFetch — network listing', () => {
  it('resolves a listing into entries and clears loading', async () => {
    const listing = [{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }]
    remoteFS.list.mockResolvedValue(listing)

    const { result } = renderHook(() => useDirFetch(makeArgs()))

    await waitFor(() => expect(result.current.entries).toEqual(listing))
    expect(remoteFS.list).toHaveBeenCalledWith('conn1', '/media')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('')
    expect(result.current.entriesRef.current).toEqual(listing)
  })

  it('sets error, empties entries and clears loading when the listing rejects', async () => {
    remoteFS.list.mockRejectedValue(new Error('Connection refused'))

    const { result } = renderHook(() => useDirFetch(makeArgs()))

    await waitFor(() => expect(result.current.error).toBe('Connection refused'))
    expect(result.current.entries).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})

describe('useDirFetch — epoch guard', () => {
  it('discards a slow listing for path A that resolves after path B was requested', async () => {
    const deferredByPath = {}
    function defer(targetPath) {
      if (!deferredByPath[targetPath]) {
        let resolve
        const promise = new Promise((r) => { resolve = r })
        deferredByPath[targetPath] = { promise, resolve }
      }
      return deferredByPath[targetPath]
    }
    remoteFS.list.mockImplementation((_connectionId, targetPath) => defer(targetPath).promise)

    const { result } = renderHook(() => useDirFetch(makeArgs()))
    await waitFor(() => expect(remoteFS.list).toHaveBeenCalledWith('conn1', '/media'))

    // Request A, then B before A has landed — B claims the newer epoch.
    act(() => { result.current.fetchDir('/media/A') })
    act(() => { result.current.fetchDir('/media/B') })

    const dataForA = [{ name: 'fileA', type: 'file', size: 0, modified: 0 }]
    const dataForB = [{ name: 'fileB', type: 'file', size: 0, modified: 0 }]

    await act(async () => { defer('/media/B').resolve(dataForB) })
    await act(async () => { defer('/media/A').resolve(dataForA) })

    expect(result.current.entries).toEqual(dataForB)
  })
})

describe('useDirFetch — cache mode stale', () => {
  it('paints the snapshot immediately, invalidates, then repaints from the network', async () => {
    const cached = [{ name: 'cached.jpg', type: 'file', size: 0, modified: 0 }]
    const fresh  = [{ name: 'fresh.jpg', type: 'file', size: 200, modified: 1 }]
    remoteFS.getSnapshot.mockReturnValue(cached)
    remoteFS.list.mockResolvedValue(fresh)

    const { result } = renderHook(() => useDirFetch(makeArgs()))

    await waitFor(() => expect(result.current.entries).toEqual(fresh))
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', '/media')
    expect(remoteFS.list).toHaveBeenCalledWith('conn1', '/media')
    expect(result.current.loading).toBe(false)
  })

  it('discards a background repaint belonging to a superseded epoch', async () => {
    const snapshotByPath = {
      '/media/A': [{ name: 'snapA', type: 'file', size: 0, modified: 0 }],
      '/media/B': [{ name: 'snapB', type: 'file', size: 0, modified: 0 }],
    }
    remoteFS.getSnapshot.mockImplementation((_connectionId, targetPath) => snapshotByPath[targetPath] ?? null)

    const deferredByPath = {}
    function defer(targetPath) {
      if (!deferredByPath[targetPath]) {
        let resolve
        const promise = new Promise((r) => { resolve = r })
        deferredByPath[targetPath] = { promise, resolve }
      }
      return deferredByPath[targetPath]
    }
    remoteFS.list.mockImplementation((_connectionId, targetPath) => defer(targetPath).promise)

    const { result } = renderHook(() => useDirFetch(makeArgs()))
    await waitFor(() => expect(remoteFS.list).toHaveBeenCalled())

    act(() => { result.current.fetchDir('/media/A') })
    expect(result.current.entries).toEqual(snapshotByPath['/media/A'])

    act(() => { result.current.fetchDir('/media/B') })
    expect(result.current.entries).toEqual(snapshotByPath['/media/B'])

    const lateRepaintForA = [{ name: 'lateA', type: 'file', size: 0, modified: 0 }]
    await act(async () => { defer('/media/A').resolve(lateRepaintForA) })

    expect(result.current.entries).toEqual(snapshotByPath['/media/B'])
  })
})

describe('useDirFetch — cache mode tree', () => {
  it('paints the snapshot and performs no network listing', async () => {
    const cached = [{ name: 'cached.jpg', type: 'file', size: 0, modified: 0 }]
    remoteFS.getSnapshot.mockReturnValue(cached)
    cacheModeRef.current = 'tree'

    const { result } = renderHook(() => useDirFetch(makeArgs()))

    await waitFor(() => expect(result.current.entries).toEqual(cached))
    expect(remoteFS.list).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('prewalks the remote tree once for an SFTP connection', async () => {
    remoteFS.getSnapshot.mockReturnValue([])
    cacheModeRef.current = 'tree'

    renderHook(() => useDirFetch(makeArgs()))

    await waitFor(() => expect(remoteFS.tree).toHaveBeenCalledWith('conn1', '/media'))
  })
})
