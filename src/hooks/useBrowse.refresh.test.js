import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBrowse } from './useBrowse'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

const CONNECTIONS = [{
  id: 'conn1', name: 'NAS', type: 'sftp', icon: 'server',
  localFolder: 'C:\\sync', operation: 'copy', folderMode: 'mirror',
  extensions: [],
  sftp: { host: 'nas', port: 22, username: 'u', password: '', keyPath: '', remotePath: '/media' },
  smb: { host: '', share: '', username: '', password: '', remotePath: '' },
}]

let queueCb
beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
  remoteFS.list.mockResolvedValue([])
  window.winraid = {
    config: { get: vi.fn().mockImplementation((k) => k === 'connections' ? Promise.resolve(CONNECTIONS) : Promise.resolve(null)), set: vi.fn() },
    remote: { list: vi.fn().mockResolvedValue({ ok: true, entries: [] }), readFile: vi.fn().mockResolvedValue({ ok: false }), onDownloadProgress: vi.fn().mockReturnValue(() => {}) },
    watcher: { list: vi.fn().mockResolvedValue({}) },
    queue: { list: vi.fn().mockResolvedValue([]), onUpdated: vi.fn((cb) => { queueCb = cb; return () => {} }), onProgress: vi.fn().mockReturnValue(() => {}) },
  }
})
afterEach(() => { vi.useRealTimers() })

function done(job) {
  return { type: 'updated', job: { status: 'DONE', connectionId: 'conn1', ...job } }
}

describe('useBrowse — upload refresh', () => {
  it('debounces a burst of completions into a single re-list', async () => {
    const { result } = renderHook(() => useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' }))
    await waitFor(() => expect(result.current.path).toBe('/media'))
    remoteFS.list.mockClear()

    vi.useFakeTimers()
    act(() => { for (let i = 0; i < 6; i++) queueCb(done({ relPath: `f${i}.jpg` })) })
    act(() => { vi.advanceTimersByTime(600) })

    expect(remoteFS.list).toHaveBeenCalledTimes(1)
  })

  it('does not re-list when the completed job landed in a different folder', async () => {
    const { result } = renderHook(() => useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' }))
    await waitFor(() => expect(result.current.path).toBe('/media'))
    remoteFS.list.mockClear()

    vi.useFakeTimers()
    act(() => { queueCb(done({ remoteDest: '/other', relPath: 'x.jpg' })) })
    act(() => { vi.advanceTimersByTime(600) })

    expect(remoteFS.list).not.toHaveBeenCalled()
  })

  it('refreshes and highlights when a job lands in the current folder', async () => {
    const { result } = renderHook(() => useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' }))
    await waitFor(() => expect(result.current.path).toBe('/media'))
    remoteFS.list.mockClear()

    vi.useFakeTimers()
    act(() => { queueCb(done({ remoteDest: '/media', relPath: 'photo.jpg', filename: 'photo.jpg' })) })
    act(() => { vi.advanceTimersByTime(600) })

    expect(remoteFS.list).toHaveBeenCalledTimes(1)
    expect(result.current.highlightFile).toBe('photo.jpg')
  })
})
