import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBrowse } from './useBrowse'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

const CONNECTIONS = [{
  id: 'conn1', name: 'NAS', type: 'sftp', icon: 'server',
  localFolder: 'C:\\sync', operation: 'copy', folderMode: 'mirror',
  extensions: [],
  sftp: { host: 'nas.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/media' },
  smb: { host: '', share: '', username: '', password: '', remotePath: '' },
}, {
  id: 'conn2', name: 'Backup', type: 'sftp', icon: 'server',
  localFolder: 'C:\\backup', operation: 'copy', folderMode: 'mirror',
  extensions: [],
  sftp: { host: 'backup.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/vault' },
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

describe('useBrowse — restore onto a different connection', () => {
  it('switches connection and clears the previous listing error without throwing', async () => {
    const { result } = renderHook(() =>
      useBrowse({
        connectionsProp: CONNECTIONS,
        connectionId: 'conn1',
        browseRestore: { connectionId: 'conn2', path: '/vault', token: 1 },
      })
    )

    await waitFor(() => expect(result.current.selectedId).toBe('conn2'))
    expect(result.current.path).toBe('/vault')
    expect(result.current.error).toBe('')
  })
})
