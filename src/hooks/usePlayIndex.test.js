import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayIndex } from './usePlayIndex'
import { createWinraidMock } from '../__mocks__/winraid'

let onMediaFoundCb = null
let onMediaDoneCb  = null
let onMediaErrorCb = null

beforeEach(() => {
  onMediaFoundCb = null
  onMediaDoneCb  = null
  onMediaErrorCb = null

  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockResolvedValue({ recursive: false, shuffle: false }),
    },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => { onMediaFoundCb = null } }),
      onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => { onMediaDoneCb  = null } }),
      onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => { onMediaErrorCb = null } }),
    },
  })
})

afterEach(() => {
  delete window.winraid
})

describe('usePlayIndex', () => {
  it('reads playDefaults from config on mount', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    expect(window.winraid.config.get).toHaveBeenCalledWith('playDefaults')
    expect(result.current.recursive).toBe(false)
    expect(result.current.shuffle).toBe(false)
  })

  it('starts a mediaScan after defaults are loaded', async () => {
    renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledWith('conn1', '/photos', { recursive: false })
  })

  it('appends files when onMediaFound fires', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [{ path: '/photos/a.jpg', size: 100, mtime: 0, type: 'image' }] })
      onMediaFoundCb?.({ files: [{ path: '/photos/b.mp4', size: 200, mtime: 0, type: 'video' }] })
    })
    expect(result.current.files).toHaveLength(2)
    expect(result.current.files[0].path).toBe('/photos/a.jpg')
  })

  it('sets scanning=false when onMediaDone fires', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    expect(result.current.scanning).toBe(true)
    act(() => { onMediaDoneCb?.({ totalMatches: 0, durationMs: 10 }) })
    expect(result.current.scanning).toBe(false)
  })

  it('next increments index, prev decrements, both clamp at boundaries', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    expect(result.current.index).toBe(0)
    act(() => result.current.next())
    expect(result.current.index).toBe(1)
    act(() => result.current.next())
    expect(result.current.index).toBe(2)
    act(() => result.current.next())
    expect(result.current.index).toBe(2)
    act(() => result.current.prev())
    expect(result.current.index).toBe(1)
    act(() => result.current.prev())
    expect(result.current.index).toBe(0)
    act(() => result.current.prev())
    expect(result.current.index).toBe(0)
  })

  it('toggleShuffle shuffles only files[index+1…end] without moving earlier files', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `/f${i}.jpg`, size: 0, mtime: 0, type: 'image',
    }))
    act(() => { onMediaFoundCb?.({ files }) })
    act(() => { result.current.setIndex(3) })
    const before = result.current.files.slice(0, 4).map((f) => f.path)
    act(() => { result.current.toggleShuffle() })
    const after = result.current.files.slice(0, 4).map((f) => f.path)
    expect(after).toEqual(before)
    const tailPaths = result.current.files.slice(4).map((f) => f.path)
    expect(tailPaths.sort()).toEqual(['/f4.jpg', '/f5.jpg', '/f6.jpg', '/f7.jpg', '/f8.jpg', '/f9.jpg'])
  })

  it('toggleRecursive cancels the scan and restarts it', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
    act(() => { result.current.toggleRecursive() })
    await act(async () => {})
    expect(window.winraid.remote.mediaCancel).toHaveBeenCalledWith('conn1')
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(2)
  })

  it('sets error and stops scanning when onMediaError fires with the root path', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaErrorCb?.({ path: '/photos', msg: 'Connection lost', code: 'ECONNRESET' })
    })
    expect(result.current.error).toBeTruthy()
    expect(result.current.scanning).toBe(false)
  })

  it('does NOT set error when onMediaError fires with a subdirectory path', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaErrorCb?.({ path: '/photos/subdir', msg: 'EACCES', code: 'EACCES' })
    })
    expect(result.current.error).toBeNull()
  })

  it('calls mediaCancel on unmount', async () => {
    const { unmount } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    unmount()
    expect(window.winraid.remote.mediaCancel).toHaveBeenCalledWith('conn1')
  })
})
