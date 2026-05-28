import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

let cleanup = () => {}

afterEach(() => {
  cleanup()
  cleanup = () => {}
})

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
      checkout: vi.fn().mockResolvedValue({ ok: true, created: [] }),
      download: vi.fn().mockResolvedValue({ ok: true, count: 1 }),
      readFile: vi.fn().mockResolvedValue({ ok: false, content: '' }),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      verifyClean: vi.fn().mockResolvedValue({ ok: true, clean: true }),
    },
    selectDownloadPath: vi.fn().mockResolvedValue('C:\\Users\\test\\Downloads'),
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
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(async () => result.current.setDeleteTarget({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    await act(() => result.current.handleDelete({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })

  it('calls remoteFS.invalidate on delete failure', async () => {
    window.winraid.remote.delete.mockResolvedValue({ ok: false, error: 'Permission denied' })
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(() => result.current.handleDelete({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', expect.any(String))
  })
})

describe('handleMove', () => {
  it('calls remoteFS.update twice — removes from src dir and adds to dst dir', async () => {
    remoteFS.list.mockResolvedValue([
      { name: 'photo.jpg', type: 'file', size: 100, modified: 0 },
    ])
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => result.current.selectedId === 'conn1' && result.current.entries.length === 1)
    // Flush pending effects so entriesRef.current is in sync with entries state
    await act(async () => {})
    await act(() =>
      result.current.handleMove('/media/photo.jpg', '/media/archive/photo.jpg')
    )
    expect(remoteFS.update).toHaveBeenCalledTimes(2)
    // First call removes from source dir
    expect(remoteFS.update).toHaveBeenNthCalledWith(1, 'conn1', expect.any(String), expect.any(Function))
    // Second call adds to destination dir
    expect(remoteFS.update).toHaveBeenNthCalledWith(2, 'conn1', expect.any(String), expect.any(Function))
  })

  it('calls remoteFS.invalidate on move failure', async () => {
    window.winraid.remote.move.mockResolvedValue({ ok: false, error: 'Move failed' })
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(() => result.current.handleMove('/media/photo.jpg', '/media/archive/photo.jpg'))
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', expect.any(String))
  })
})

describe('handleCreateFolder', () => {
  it('calls remoteFS.update to add the new folder to cache', async () => {
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => result.current.selectedId === 'conn1')
    await act(async () => result.current.setNewFolderName('NewAlbum'))
    await act(() => result.current.handleCreateFolder())
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })

  it('calls remoteFS.invalidate on folder creation failure', async () => {
    window.winraid.remote.mkdir.mockResolvedValue({ ok: false, error: 'mkdir failed' })
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
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
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
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
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => result.current.selectedId === 'conn1' && result.current.entries.length === 1)
    await act(async () => result.current.selectAll?.())
    await act(async () => result.current.setBulkMoveDest('/media/archive'))
    await act(() => result.current.handleBulkMove())
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })
})

describe('selection clearing after bulk operations', () => {
  it('handleBulkDelete clears selection after running', async () => {
    remoteFS.list.mockResolvedValue([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
      { name: 'b.jpg', type: 'file', size: 200, modified: 0 },
    ])
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => {
      expect(result.current.selectedId).toBe('conn1')
      expect(result.current.entries.length).toBe(2)
    })
    await act(async () => result.current.toggleSelectAll())
    await waitFor(() => expect(result.current.selected.size).toBe(2))
    await act(() => result.current.handleBulkDelete())
    expect(result.current.selected.size).toBe(0)
  })

  it('handleBulkMove clears selection after running', async () => {
    remoteFS.list.mockResolvedValue([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
      { name: 'b.jpg', type: 'file', size: 200, modified: 0 },
    ])
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => {
      expect(result.current.selectedId).toBe('conn1')
      expect(result.current.entries.length).toBe(2)
    })
    await act(async () => result.current.toggleSelectAll())
    await waitFor(() => expect(result.current.selected.size).toBe(2))
    await act(async () => result.current.setBulkMoveDest('/media/archive'))
    await act(() => result.current.handleBulkMove())
    expect(result.current.selected.size).toBe(0)
  })

  it('handleBulkCheckout opens a folder picker and downloads each selected item to the chosen folder', async () => {
    remoteFS.list.mockResolvedValue([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
      { name: 'b.jpg', type: 'file', size: 200, modified: 0 },
    ])
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => {
      expect(result.current.selectedId).toBe('conn1')
      expect(result.current.entries.length).toBe(2)
    })
    await act(async () => result.current.toggleSelectAll())
    await waitFor(() => expect(result.current.selected.size).toBe(2))
    await act(() => result.current.handleBulkCheckout())
    // Folder picker invoked with isDir=true.
    expect(window.winraid.selectDownloadPath).toHaveBeenCalledWith('', true)
    // One download call per selected file, destination joined under chosen folder.
    expect(window.winraid.remote.download).toHaveBeenCalledWith('conn1', '/media/a.jpg', 'C:\\Users\\test\\Downloads\\a.jpg', false)
    expect(window.winraid.remote.download).toHaveBeenCalledWith('conn1', '/media/b.jpg', 'C:\\Users\\test\\Downloads\\b.jpg', false)
    // Selection cleared after running.
    expect(result.current.selected.size).toBe(0)
  })

  it('handleBulkCheckout does nothing if the user cancels the folder picker', async () => {
    window.winraid.selectDownloadPath.mockResolvedValue(null)
    remoteFS.list.mockResolvedValue([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
    ])
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => expect(result.current.entries.length).toBe(1))
    await act(async () => result.current.toggleSelectAll())
    await waitFor(() => expect(result.current.selected.size).toBe(1))
    await act(() => result.current.handleBulkCheckout())
    // No download attempted, selection preserved so the user can retry.
    expect(window.winraid.remote.download).not.toHaveBeenCalled()
    expect(result.current.selected.size).toBe(1)
  })

  it('handleBulkCheckout passes the chosen folder as-is for directory entries (backend appends basename internally)', async () => {
    remoteFS.list.mockResolvedValue([
      { name: 'subdir', type: 'dir', size: 0, modified: 0 },
    ])
    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => expect(result.current.entries.length).toBe(1))
    await act(async () => result.current.toggleSelectAll())
    await waitFor(() => expect(result.current.selected.size).toBe(1))
    await act(() => result.current.handleBulkCheckout())
    expect(window.winraid.remote.download).toHaveBeenCalledWith('conn1', '/media/subdir', 'C:\\Users\\test\\Downloads', true)
  })
})

describe('handlePasteImage / handleConfirmPaste / handleDiscardPaste', () => {
  let createObjectURL, revokeObjectURL
  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:fake')
    revokeObjectURL = vi.fn()
    Object.defineProperty(globalThis, 'URL', {
      configurable: true,
      value: { ...globalThis.URL, createObjectURL, revokeObjectURL },
    })
  })

  it('handlePasteImage stages the blob without writing', async () => {
    window.winraid.remote.writeFileBinary = vi.fn().mockResolvedValue({ ok: true })

    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => expect(result.current.selectedId).toBe('conn1'))

    const blob = new Blob(['x'], { type: 'image/png' })
    await act(() => result.current.handlePasteImage(blob))

    expect(result.current.pendingPaste).toBeTruthy()
    expect(result.current.pendingPaste.previewUrl).toBe('blob:fake')
    expect(result.current.pendingPaste.mime).toBe('image/png')
    expect(window.winraid.remote.writeFileBinary).not.toHaveBeenCalled()
  })

  it('handleConfirmPaste writes the staged blob and clears pendingPaste', async () => {
    window.winraid.remote.list = vi.fn().mockResolvedValue({ ok: true, entries: [] })
    window.winraid.remote.writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid.cache = { invalidateFile: vi.fn().mockResolvedValue({ ok: true }) }

    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => expect(result.current.selectedId).toBe('conn1'))

    const blob = new Blob(['x'], { type: 'image/png' })
    await act(() => result.current.handlePasteImage(blob))
    await act(() => result.current.handleConfirmPaste())

    expect(window.winraid.remote.writeFileBinary).toHaveBeenCalledTimes(1)
    const [, dest] = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(dest).toMatch(/\/pasted_\d{4}-\d{2}-\d{2}_\d{6}\.png$/)
    expect(result.current.pendingPaste).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('handlePasteUrl fetches via IPC and stages with suggestedName + sourceUrl', async () => {
    const fakeBytes = new ArrayBuffer(8)
    window.winraid.url = {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        mime: 'image/png',
        filename: 'logo.png',
        bytes: fakeBytes,
      }),
    }

    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => expect(result.current.selectedId).toBe('conn1'))

    await act(() => result.current.handlePasteUrl('https://example.com/logo.png'))

    expect(window.winraid.url.fetch).toHaveBeenCalledWith('https://example.com/logo.png')
    expect(result.current.pendingPaste).toBeTruthy()
    expect(result.current.pendingPaste.mime).toBe('image/png')
    expect(result.current.pendingPaste.suggestedName).toBe('logo.png')
    expect(result.current.pendingPaste.sourceUrl).toBe('https://example.com/logo.png')
  })

  it('handleConfirmPaste uses suggestedName when present (no timestamp prefix)', async () => {
    const fakeBytes = new ArrayBuffer(4)
    window.winraid.url = {
      fetch: vi.fn().mockResolvedValue({ ok: true, mime: 'image/png', filename: 'pic.png', bytes: fakeBytes }),
    }
    window.winraid.remote.list = vi.fn().mockResolvedValue({ ok: true, entries: [] })
    window.winraid.remote.writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid.cache = { invalidateFile: vi.fn().mockResolvedValue({ ok: true }) }

    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => expect(result.current.selectedId).toBe('conn1'))

    await act(() => result.current.handlePasteUrl('https://example.com/pic.png'))
    await act(() => result.current.handleConfirmPaste())

    const [, dest] = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(dest).toMatch(/\/pic\.png$/)
  })

  it('handleDiscardPaste clears pendingPaste without writing', async () => {
    window.winraid.remote.writeFileBinary = vi.fn().mockResolvedValue({ ok: true })

    const { result, unmount } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    cleanup = unmount
    await waitFor(() => expect(result.current.selectedId).toBe('conn1'))

    const blob = new Blob(['x'], { type: 'image/png' })
    await act(() => result.current.handlePasteImage(blob))
    expect(result.current.pendingPaste).toBeTruthy()

    await act(() => result.current.handleDiscardPaste())
    expect(result.current.pendingPaste).toBeNull()
    expect(window.winraid.remote.writeFileBinary).not.toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})
