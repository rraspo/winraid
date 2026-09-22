import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useClipboard } from './useClipboard'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

let cleanup = () => {}

afterEach(() => {
  cleanup()
  cleanup = () => {}
  delete window.winraid
})

beforeEach(() => {
  vi.clearAllMocks()
})

function mockWinraid(overrides = {}) {
  window.winraid = {
    clipboard: {
      set: vi.fn().mockResolvedValue({ ok: true }),
      get: vi.fn().mockResolvedValue(null),
      clear: vi.fn().mockResolvedValue({ ok: true }),
      ...overrides.clipboard,
    },
    remote: {
      move: vi.fn().mockResolvedValue({ ok: true }),
      copy: vi.fn().mockResolvedValue({ ok: true, via: 'ssh cp' }),
      execCapable: vi.fn().mockResolvedValue({ ok: true, capable: true }),
      ...overrides.remote,
    },
  }
}

const ENTRY_A = { name: 'a.jpg', type: 'file', size: 100, modified: 0 }
const ENTRY_B = { name: 'b.jpg', type: 'file', size: 200, modified: 0 }

function mountClipboard(props = {}) {
  const setStatus = vi.fn()
  const setOpInFlight = vi.fn()
  const fetchDir = vi.fn().mockResolvedValue(undefined)
  const cancelledRef = { current: false }
  const { result, unmount } = renderHook(() => useClipboard({
    selectedId: 'conn1',
    path: '/media',
    selectedEntries: [ENTRY_A],
    cancelledRef,
    fetchDir,
    setStatus,
    setOpInFlight,
    ...props,
  }))
  cleanup = unmount
  return { result, setStatus, setOpInFlight, fetchDir, cancelledRef }
}

describe('useClipboard — cut/copy record a pointer', () => {
  it('handleCut sends the mode, connectionId and full paths of the selection', async () => {
    mockWinraid()
    const { result } = mountClipboard({ selectedEntries: [ENTRY_A, ENTRY_B] })
    await act(async () => result.current.handleCut())
    expect(window.winraid.clipboard.set).toHaveBeenCalledWith('cut', 'conn1', ['/media/a.jpg', '/media/b.jpg'])
  })

  it('handleCopy records copy mode', async () => {
    mockWinraid()
    const { result } = mountClipboard()
    await act(async () => result.current.handleCopy())
    expect(window.winraid.clipboard.set).toHaveBeenCalledWith('copy', 'conn1', ['/media/a.jpg'])
  })

  it('does nothing with an empty selection', async () => {
    mockWinraid()
    const { result } = mountClipboard({ selectedEntries: [] })
    await act(async () => result.current.handleCut())
    expect(window.winraid.clipboard.set).not.toHaveBeenCalled()
  })

  it('hasClipboard reflects the main process buffer after cut/copy', async () => {
    mockWinraid()
    window.winraid.clipboard.get.mockResolvedValue({ mode: 'cut', connectionId: 'conn1', paths: ['/media/a.jpg'] })
    const { result } = mountClipboard()
    await act(async () => result.current.handleCut())
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))
    expect(result.current.clipboardMode).toBe('cut')
  })

  it('hasClipboard is false when the buffer starts empty', async () => {
    mockWinraid()
    const { result } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(false))
  })
})

describe('useClipboard — paste after cut (server-side move)', () => {
  it('moves every clipboard path into the current directory, clears the clipboard, and refreshes the listing', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'cut', connectionId: 'conn1', paths: ['/other/a.jpg', '/other/b.jpg'] }) },
    })
    const { result, setStatus, fetchDir } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(window.winraid.remote.move).toHaveBeenNthCalledWith(1, 'conn1', '/other/a.jpg', '/media/a.jpg')
    expect(window.winraid.remote.move).toHaveBeenNthCalledWith(2, 'conn1', '/other/b.jpg', '/media/b.jpg')
    expect(window.winraid.remote.copy).not.toHaveBeenCalled()
    expect(window.winraid.clipboard.clear).toHaveBeenCalled()
    expect(fetchDir).toHaveBeenCalledWith('/media')
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', '/other')
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', '/media')
    expect(setStatus).toHaveBeenCalledWith({ ok: true, msg: 'Pasted 2 items' })
  })

  it('reuses moveRemotePath through the existing remote:move channel — no second move path', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'cut', connectionId: 'conn1', paths: ['/other/a.jpg'] }) },
    })
    const { result } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))
    await act(async () => result.current.handlePasteClipboard())
    expect(window.winraid.remote.move).toHaveBeenCalledTimes(1)
  })
})

describe('useClipboard — paste after copy (server-side cp)', () => {
  it('copies every clipboard path and clears the clipboard on full success', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'copy', connectionId: 'conn1', paths: ['/other/a.jpg'] }) },
    })
    const { result, setStatus } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(window.winraid.remote.copy).toHaveBeenCalledWith('conn1', '/other/a.jpg', '/media/a.jpg')
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
    expect(window.winraid.clipboard.clear).toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith({ ok: true, msg: 'Pasted 1 item' })
  })

  it('surfaces the exact no-exec message from a restricted connection rather than a generic failure', async () => {
    const NO_EXEC = 'This connection cannot run commands on the server, so files cannot be copied here. Cut and paste still works on this connection.'
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'copy', connectionId: 'conn1', paths: ['/other/a.jpg'] }) },
      remote: { copy: vi.fn().mockResolvedValue({ ok: false, error: NO_EXEC, via: 'ssh cp' }) },
    })
    const { result, setStatus } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(setStatus).toHaveBeenCalledWith({ ok: false, msg: `Pasted 0, failed 1: ${NO_EXEC}` })
    expect(window.winraid.clipboard.clear).not.toHaveBeenCalled()
  })
})

describe('useClipboard — unhappy paths', () => {
  it('refuses a cross-connection paste with a clear message and touches nothing', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'cut', connectionId: 'conn-OTHER', paths: ['/other/a.jpg'] }) },
    })
    const { result, setStatus, fetchDir } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(window.winraid.remote.move).not.toHaveBeenCalled()
    expect(window.winraid.remote.copy).not.toHaveBeenCalled()
    expect(window.winraid.clipboard.clear).not.toHaveBeenCalled()
    expect(fetchDir).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      msg: expect.stringMatching(/only work within the same connection/i),
    }))
  })

  it('reports a stale pointer (source deleted since cut) as a per-file failure, clipboard left intact', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'cut', connectionId: 'conn1', paths: ['/other/a.jpg', '/other/b.jpg'] }) },
      remote: {
        move: vi.fn().mockImplementation(async (_id, srcPath) =>
          srcPath === '/other/a.jpg' ? { ok: false, error: 'No such file or directory' } : { ok: true }),
      },
    })
    const { result, setStatus } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(setStatus).toHaveBeenCalledWith({ ok: false, msg: 'Pasted 1, failed 1: No such file or directory' })
    expect(window.winraid.clipboard.clear).not.toHaveBeenCalled()
  })

  it('reports a stale destination folder (removed since navigating here) without crashing', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'copy', connectionId: 'conn1', paths: ['/other/a.jpg'] }) },
      remote: { copy: vi.fn().mockResolvedValue({ ok: false, error: 'No such file or directory' }) },
    })
    const { result, setStatus } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(setStatus).toHaveBeenCalledWith({ ok: false, msg: 'Pasted 0, failed 1: No such file or directory' })
  })

  it('a permission failure on one file does not abort the rest of the batch', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'cut', connectionId: 'conn1', paths: ['/other/a.jpg', '/other/b.jpg'] }) },
      remote: {
        move: vi.fn().mockImplementation(async (_id, srcPath) =>
          srcPath === '/other/a.jpg' ? { ok: false, error: 'Permission denied' } : { ok: true }),
      },
    })
    const { result } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(window.winraid.remote.move).toHaveBeenCalledTimes(2)
  })

  it('refuses pasting into the same directory the file already sits in, without attempting the move', async () => {
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'cut', connectionId: 'conn1', paths: ['/media/a.jpg'] }) },
    })
    const { result, setStatus } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(window.winraid.remote.move).not.toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith({ ok: false, msg: 'Pasted 0, failed 1: a.jpg is already in this location' })
  })

  it('a mid-transfer disconnect (cancelledRef flips true) stops the loop and skips the summary toast', async () => {
    const cancelledRef = { current: false }
    mockWinraid({
      clipboard: { get: vi.fn().mockResolvedValue({ mode: 'cut', connectionId: 'conn1', paths: ['/other/a.jpg', '/other/b.jpg'] }) },
      remote: {
        move: vi.fn().mockImplementation(async (_id, srcPath) => {
          if (srcPath === '/other/a.jpg') cancelledRef.current = true
          return { ok: true }
        }),
      },
    })
    const { result, setStatus, fetchDir } = mountClipboard({ cancelledRef })
    await waitFor(() => expect(result.current.hasClipboard).toBe(true))

    await act(async () => result.current.handlePasteClipboard())

    expect(window.winraid.remote.move).toHaveBeenCalledTimes(1)
    expect(fetchDir).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalledWith(expect.objectContaining({ msg: expect.any(String) }))
  })

  it('an empty clipboard is a no-op', async () => {
    mockWinraid()
    const { result, setStatus } = mountClipboard()
    await waitFor(() => expect(result.current.hasClipboard).toBe(false))
    await act(async () => result.current.handlePasteClipboard())
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalled()
  })
})

describe('useClipboard — exec capability', () => {
  it('reflects the probed capability for the current connection', async () => {
    mockWinraid({ remote: { execCapable: vi.fn().mockResolvedValue({ ok: true, capable: false }) } })
    const { result } = mountClipboard()
    await waitFor(() => expect(result.current.execCapable).toBe(false))
  })

  it('defaults to null (unknown) before the probe resolves, and null with no connection selected', async () => {
    mockWinraid()
    const { result } = mountClipboard({ selectedId: null })
    await waitFor(() => expect(result.current.execCapable).toBeNull())
    expect(window.winraid.remote.execCapable).not.toHaveBeenCalled()
  })
})
