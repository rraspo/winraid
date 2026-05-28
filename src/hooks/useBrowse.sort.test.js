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
  { name: 'banana.txt', type: 'file', size: 10, modified: 300 },
  { name: 'docs',       type: 'dir',  size: 0,  modified: 100 },
  { name: 'apple.txt',  type: 'file', size: 20, modified: 200 },
  { name: 'photos',     type: 'dir',  size: 0,  modified: 400 },
]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
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

async function setup() {
  const hook = renderHook(() =>
    useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
  )
  await waitFor(() => expect(hook.result.current.entries.length).toBe(4))
  return hook
}

describe('useBrowse — sort integration', () => {
  it('exposes sortMode defaulting to nameAsc', async () => {
    const { result } = await setup()
    expect(result.current.sortMode).toBe('nameAsc')
  })

  it('default sort is dirs-first + nameAsc in entriesWithPaths', async () => {
    const { result } = await setup()
    expect(result.current.entriesWithPaths.map((e) => e.name)).toEqual([
      'docs', 'photos', 'apple.txt', 'banana.txt',
    ])
  })

  it('setSortMode changes the sort order', async () => {
    const { result } = await setup()
    act(() => result.current.setSortMode('recent'))
    expect(result.current.sortMode).toBe('recent')
    expect(result.current.entriesWithPaths.map((e) => e.name)).toEqual([
      'photos', 'docs', 'banana.txt', 'apple.txt',
    ])
  })

  it('sort applies after search filter', async () => {
    const { result } = await setup()
    act(() => result.current.setSortMode('nameDesc'))
    act(() => result.current.setSearchQuery('a'))
    await waitFor(() =>
      expect(result.current.entriesWithPaths.map((e) => e.name)).toEqual([
        'banana.txt', 'apple.txt',
      ])
    )
  })
})
