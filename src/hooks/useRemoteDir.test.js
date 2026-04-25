import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRemoteDir } from './useRemoteDir'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
})

describe('useRemoteDir', () => {
  it('returns null when cache is empty', () => {
    const { result } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(result.current).toBeNull()
  })

  it('returns cached entries from getSnapshot', () => {
    const entries = [{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }]
    remoteFS.getSnapshot.mockReturnValue(entries)
    const { result } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(result.current).toBe(entries)
  })

  it('subscribes to remoteFS and unsubscribes on unmount', () => {
    const unsub = vi.fn()
    remoteFS.subscribe.mockReturnValue(unsub)
    const { unmount } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(remoteFS.subscribe).toHaveBeenCalled()
    unmount()
    expect(unsub).toHaveBeenCalled()
  })

  it('re-renders when remoteFS notifies', () => {
    let notifyFn
    remoteFS.subscribe.mockImplementation((fn) => {
      notifyFn = fn
      return () => {}
    })
    const entries = [{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }]
    remoteFS.getSnapshot.mockReturnValue(null)
    const { result } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(result.current).toBeNull()
    remoteFS.getSnapshot.mockReturnValue(entries)
    act(() => notifyFn())
    expect(result.current).toBe(entries)
  })
})
