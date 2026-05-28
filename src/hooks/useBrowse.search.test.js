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

const ENTRIES = [
  { name: 'alpha.txt', type: 'file', size: 1, modified: 0 },
  { name: 'beta.txt',  type: 'file', size: 1, modified: 0 },
  { name: 'gamma.txt', type: 'file', size: 1, modified: 0 },
  { name: 'delta.txt', type: 'file', size: 1, modified: 0 },
]

beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
  remoteFS.list.mockResolvedValue(ENTRIES)
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

async function setupWithEntries() {
  const hook = renderHook(() =>
    useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
  )
  await waitFor(() => expect(hook.result.current.entries).toEqual(ENTRIES))
  return hook
}

describe('useBrowse — selection over filtered entries', () => {
  it('handleItemPointer resolves index against the filtered list when a search query is active', async () => {
    const { result } = await setupWithEntries()

    // Type "gam" — filteredEntries collapses to just [gamma.txt]
    act(() => result.current.setSearchQuery('gam'))
    await waitFor(() => expect(result.current.entriesWithPaths.map((e) => e.name)).toEqual(['gamma.txt']))

    // Click the first (and only) visible row. Index 0 of the FILTERED list
    // is gamma.txt. The bug we're guarding against: index 0 used to resolve
    // against unfiltered entries → alpha.txt.
    act(() => result.current.handleItemPointer(0, {}))
    expect(result.current.selected).toEqual(new Set(['gamma.txt']))
  })

  it('handleRubberBandEnd resolves intersected indexes against the filtered list', async () => {
    const { result } = await setupWithEntries()

    // Filter to two entries: alpha + gamma (both contain "a")... actually
    // pick something tighter so the test is unambiguous. "ta" matches
    // beta and delta only.
    act(() => result.current.setSearchQuery('ta'))
    await waitFor(() => expect(result.current.entriesWithPaths.map((e) => e.name)).toEqual(['beta.txt', 'delta.txt']))

    // Lasso selects rows 0 and 1 of the FILTERED list → beta + delta.
    act(() => result.current.handleRubberBandEnd([0, 1], {}))
    expect(result.current.selected).toEqual(new Set(['beta.txt', 'delta.txt']))
  })

  it('shift-click range extends across the filtered list, not the unfiltered one', async () => {
    const { result } = await setupWithEntries()

    act(() => result.current.setSearchQuery('a'))
    // "a" matches alpha, beta, gamma, delta — all four. Re-filter to
    // something tighter to make the range meaningful.
    act(() => result.current.setSearchQuery('t'))
    await waitFor(() =>
      expect(result.current.entriesWithPaths.map((e) => e.name)).toEqual([
        'alpha.txt', 'beta.txt', 'delta.txt', 'gamma.txt',
      ])
    )
    // All four still match — narrow further.
    act(() => result.current.setSearchQuery('e'))
    await waitFor(() =>
      expect(result.current.entriesWithPaths.map((e) => e.name)).toEqual(['beta.txt', 'delta.txt'])
    )

    // Click filtered row 0 (beta), then shift-click filtered row 1 (delta).
    // Pre-fix this would have resolved to alpha + beta from the unfiltered list.
    act(() => result.current.handleItemPointer(0, {}))
    act(() => result.current.handleItemPointer(1, { shift: true }))
    expect(result.current.selected).toEqual(new Set(['beta.txt', 'delta.txt']))
  })
})
