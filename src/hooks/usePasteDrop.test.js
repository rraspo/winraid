import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePasteDrop } from './usePasteDrop'
import { createWinraidMock } from '../__mocks__/winraid'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

const CONNECTION = {
  id: 'conn1', name: 'NAS', type: 'sftp',
  sftp: { host: 'nas.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/media' },
  smb: { host: '', share: '', username: '', password: '', remotePath: '' },
}

// Pinned so the timestamp-derived paste filename is predictable. Only Date is
// faked — the hook awaits real promises, which fake timers would stall.
const FROZEN_NOW = new Date(2026, 0, 15, 10, 30, 0)
const FROZEN_STEM = 'pasted_2026-01-15_103000'

let fetchDirSpy
let setEntriesSpy
let setOpInFlightSpy
let setStatusSpy
let setHighlightFileSpy
let createObjectURL
let revokeObjectURL

// Mirrors the argument object useBrowse composes the hook with, so each test
// only states the knob it varies.
function makeArgs(overrides = {}) {
  return {
    selectedId:       'conn1',
    selectedConn:     CONNECTION,
    path:             '/media',
    fetchDir:         fetchDirSpy,
    setEntries:       setEntriesSpy,
    setOpInFlight:    setOpInFlightSpy,
    setStatus:        setStatusSpy,
    setHighlightFile: setHighlightFileSpy,
    ...overrides,
  }
}

// A DataTransfer stand-in: `types` drives the acceptability check, `data`
// backs getData for the URL extraction that follows a committed drop.
function makeDragEvent({ types = [], data = {}, files = [] } = {}) {
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types,
      files,
      getData: (type) => data[type] ?? '',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FROZEN_NOW)

  fetchDirSpy         = vi.fn().mockResolvedValue(undefined)
  setEntriesSpy       = vi.fn()
  setOpInFlightSpy    = vi.fn()
  setStatusSpy        = vi.fn()
  setHighlightFileSpy = vi.fn()

  createObjectURL = vi.fn(() => 'blob:fake')
  revokeObjectURL = vi.fn()
  Object.defineProperty(globalThis, 'URL', {
    configurable: true,
    value: { ...globalThis.URL, createObjectURL, revokeObjectURL },
  })

  remoteFS.list.mockResolvedValue([])
  remoteFS.getSnapshot.mockReturnValue(null)
  window.winraid = createWinraidMock()
})

afterEach(() => {
  vi.useRealTimers()
  delete window.winraid
})

describe('usePasteDrop — pasted-image naming', () => {
  it('generates a non-colliding name against the destination listing', async () => {
    window.winraid.remote.list.mockResolvedValue({ ok: true, entries: [] })

    const { result } = renderHook(() => usePasteDrop(makeArgs()))

    const blob = new Blob(['x'], { type: 'image/png' })
    await act(() => result.current.handlePasteImage(blob))
    await act(() => result.current.handleConfirmPaste())

    expect(window.winraid.remote.writeFileBinary).toHaveBeenCalledTimes(1)
    const [connectionId, destination] = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(connectionId).toBe('conn1')
    expect(destination).toBe(`/media/${FROZEN_STEM}.png`)
  })

  it('picks the next numeric suffix when the generated name already exists', async () => {
    window.winraid.remote.list.mockResolvedValue({
      ok: true,
      entries: [{ name: `${FROZEN_STEM}.png`, type: 'file' }],
    })

    const { result } = renderHook(() => usePasteDrop(makeArgs()))

    const blob = new Blob(['x'], { type: 'image/png' })
    await act(() => result.current.handlePasteImage(blob))
    await act(() => result.current.handleConfirmPaste())

    const [, destination] = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(destination).toBe(`/media/${FROZEN_STEM}_2.png`)
  })
})

describe('usePasteDrop — external drop rejection', () => {
  it('ignores a text/plain payload that carries no URL, without writing', async () => {
    const { result } = renderHook(() => usePasteDrop(makeArgs()))

    const event = makeDragEvent({
      types: ['text/plain'],
      data: { 'text/plain': 'just some selected prose' },
    })

    await act(() => result.current.handleExternalDragOver(event))
    expect(result.current.externalDropActive).toBe(false)

    await act(() => result.current.handleExternalDrop(event))

    expect(window.winraid.url.fetch).not.toHaveBeenCalled()
    expect(window.winraid.remote.writeFileBinary).not.toHaveBeenCalled()
    expect(window.winraid.queue.dropUpload).not.toHaveBeenCalled()
  })

  it('activates the drop overlay for a text/uri-list payload', async () => {
    const { result } = renderHook(() => usePasteDrop(makeArgs()))

    await act(() => result.current.handleExternalDragOver(makeDragEvent({ types: ['text/uri-list'] })))

    await waitFor(() => expect(result.current.externalDropActive).toBe(true))
  })
})

describe('usePasteDrop — discard', () => {
  it('revokes the pending object URL and clears the staged paste', async () => {
    const { result } = renderHook(() => usePasteDrop(makeArgs()))

    const blob = new Blob(['x'], { type: 'image/png' })
    await act(() => result.current.handlePasteImage(blob))
    expect(result.current.pendingPaste).toBeTruthy()
    expect(createObjectURL).toHaveBeenCalledWith(blob)

    await act(() => result.current.handleDiscardPaste())

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    expect(result.current.pendingPaste).toBeNull()
    expect(window.winraid.remote.writeFileBinary).not.toHaveBeenCalled()
  })
})

describe('usePasteDrop — confirm cache reconciliation', () => {
  it('invalidates the destination directory and refreshes the listing', async () => {
    const fresh = [{ name: `${FROZEN_STEM}.png`, type: 'file', size: 1, modified: 0 }]
    window.winraid.remote.list.mockResolvedValue({ ok: true, entries: [] })
    remoteFS.list.mockResolvedValue(fresh)

    const { result } = renderHook(() => usePasteDrop(makeArgs()))

    const blob = new Blob(['x'], { type: 'image/png' })
    await act(() => result.current.handlePasteImage(blob))
    await act(() => result.current.handleConfirmPaste())

    expect(window.winraid.cache.invalidateFile).toHaveBeenCalledWith('conn1', `/media/${FROZEN_STEM}.png`)
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', '/media')
    expect(remoteFS.list).toHaveBeenCalledWith('conn1', '/media')
    expect(setEntriesSpy).toHaveBeenCalledWith(fresh)
    expect(setHighlightFileSpy).toHaveBeenCalledWith(`${FROZEN_STEM}.png`)
    expect(result.current.pendingPaste).toBeNull()
  })
})

describe('usePasteDrop — external URL drop and navigation', () => {
  // Drives a URL drop through handleExternalDrop (the public entry point;
  // handleExternalUrlDrop itself is an internal helper) with the URL fetch
  // held open so the test can navigate the user away mid-flight, then release
  // it and inspect what got written vs. what got painted.
  async function runUrlDrop({ navigateAway = false, fetchResult = null } = {}) {
    window.winraid.remote.list.mockResolvedValue({ ok: true, entries: [] })
    remoteFS.list.mockResolvedValue([{ name: 'a.png', type: 'file', size: 1, modified: 0 }])

    let resolveFetch
    window.winraid.url.fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))

    const { result, rerender } = renderHook((props) => usePasteDrop(props), {
      initialProps: makeArgs({ path: '/a' }),
    })

    const event = makeDragEvent({
      types: ['text/uri-list'],
      data: { 'text/uri-list': 'https://example.com/a.png' },
    })

    let dropPromise
    act(() => { dropPromise = result.current.handleExternalDrop(event) })
    await waitFor(() => expect(window.winraid.url.fetch).toHaveBeenCalled())

    if (navigateAway) rerender(makeArgs({ path: '/b' }))

    await act(async () => {
      resolveFetch(fetchResult ?? { ok: true, mime: 'image/png', filename: 'a.png', bytes: new ArrayBuffer(4) })
      await dropPromise
    })

    return { result, rerender }
  }

  it('writes to the captured directory and invalidates it, but does not paint the view once the user has navigated away', async () => {
    await runUrlDrop({ navigateAway: true })

    const [connectionId, destination] = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(connectionId).toBe('conn1')
    expect(destination).toBe('/a/a.png')
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', '/a')
    expect(setEntriesSpy).not.toHaveBeenCalled()
    expect(fetchDirSpy).not.toHaveBeenCalledWith('/a')
  })

  it('refreshes the visible listing when the user has not navigated away', async () => {
    await runUrlDrop({ navigateAway: false })

    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', '/a')
    expect(remoteFS.list).toHaveBeenCalledWith('conn1', '/a')
    expect(setEntriesSpy).toHaveBeenCalledWith([{ name: 'a.png', type: 'file', size: 1, modified: 0 }])
  })

  it.each([
    ['stayed put', false],
    ['navigated away', true],
  ])('surfaces a success toast when the drop completes (%s)', async (_label, navigateAway) => {
    await runUrlDrop({ navigateAway })

    expect(setStatusSpy).toHaveBeenCalledWith({ ok: true, msg: 'Uploaded 1 file' })
  })

  it('reports a failed fetch and does not paint a stale directory once the user has navigated away', async () => {
    await runUrlDrop({ navigateAway: true, fetchResult: { ok: false, error: 'Fetch failed: https://example.com/a.png' } })

    expect(window.winraid.remote.writeFileBinary).not.toHaveBeenCalled()
    expect(remoteFS.invalidate).toHaveBeenCalledWith('conn1', '/a')
    expect(setEntriesSpy).not.toHaveBeenCalled()
    expect(fetchDirSpy).not.toHaveBeenCalledWith('/a')
    expect(setStatusSpy).toHaveBeenCalledWith({ ok: false, msg: 'Fetch failed: https://example.com/a.png' })
  })
})
