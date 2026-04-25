import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBrowse } from './useBrowse'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

const CONNECTIONS = [{
  id: 'conn1', name: 'NAS', type: 'sftp', icon: 'server',
  localFolder: 'C:\\sync', operation: 'copy', folderMode: 'mirror', extensions: [],
  sftp: { host: 'nas.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/media' },
  smb: { host: '', share: '', username: '', password: '', remotePath: '' },
}]

beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
  remoteFS.list.mockResolvedValue([])
  remoteFS.tree.mockResolvedValue(undefined)
  window.winraid = {
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        if (key === 'browse') return Promise.resolve({ cacheMutation: 'update' })
        return Promise.resolve(null)
      }),
      set: vi.fn(),
    },
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      move: vi.fn().mockResolvedValue({ ok: true }),
      mkdir: vi.fn().mockResolvedValue({ ok: true }),
      readFile: vi.fn().mockResolvedValue({ ok: false, content: '' }),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      verifyClean: vi.fn().mockResolvedValue({ ok: true, clean: true }),
    },
    watcher: { list: vi.fn().mockResolvedValue({}) },
    queue: {
      list: vi.fn().mockResolvedValue([]),
      onUpdated: vi.fn().mockReturnValue(() => {}),
      onProgress: vi.fn().mockReturnValue(() => {}),
    },
  }
})

describe('handleDelete', () => {
  it('calls remoteFS.update to remove the deleted entry from cache', async () => {
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(async () => result.current.setDeleteTarget({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    await act(() => result.current.handleDelete({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })

  it('calls remoteFS.invalidate on delete failure', async () => {
    window.winraid.remote.delete.mockResolvedValue({ ok: false, error: 'Permission denied' })
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(() => result.current.handleDelete({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', expect.any(String))
  })
})

describe('handleMove', () => {
  it('calls remoteFS.update on src dir to remove moved entry', async () => {
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(() => result.current.handleMove('/media/photo.jpg', '/media/archive/photo.jpg'))
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })

  it('calls remoteFS.invalidate on move failure', async () => {
    window.winraid.remote.move.mockResolvedValue({ ok: false, error: 'Move failed' })
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(() => result.current.handleMove('/media/photo.jpg', '/media/archive/photo.jpg'))
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', expect.any(String))
  })
})

describe('handleCreateFolder', () => {
  it('calls remoteFS.update to add the new folder to cache', async () => {
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(async () => result.current.setNewFolderName('NewAlbum'))
    await act(() => result.current.handleCreateFolder())
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })

  it('calls remoteFS.invalidate on folder creation failure', async () => {
    window.winraid.remote.mkdir.mockResolvedValue({ ok: false, error: 'mkdir failed' })
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(async () => result.current.setNewFolderName('BadFolder'))
    await act(() => result.current.handleCreateFolder())
    expect(remoteFS.invalidate).not.toHaveBeenCalled()
  })
})

describe('handleBulkDelete', () => {
  it('calls remoteFS.update to remove deleted entries from cache', async () => {
    remoteFS.list.mockResolvedValue([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
      { name: 'b.jpg', type: 'file', size: 200, modified: 0 },
    ])
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1' && result.current.entries.length === 2)
    await act(async () => result.current.selectAll?.())
    await act(() => result.current.handleBulkDelete())
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })
})

describe('handleBulkMove', () => {
  it('calls remoteFS.update to remove moved entries from cache', async () => {
    remoteFS.list.mockResolvedValue([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
    ])
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => result.current.selectedId === 'conn1' && result.current.entries.length === 1)
    await act(async () => result.current.selectAll?.())
    await act(async () => result.current.setBulkMoveDest('/media/archive'))
    await act(() => result.current.handleBulkMove())
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })
})
