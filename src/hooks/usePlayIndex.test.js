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

  it('first emitted file becomes playlist[0]; rest of the batch goes to the pool', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/photos/a.jpg', size: 100, mtime: 0, type: 'image' },
        { path: '/photos/b.jpg', size: 100, mtime: 0, type: 'image' },
        { path: '/photos/c.jpg', size: 100, mtime: 0, type: 'image' },
      ] })
    })
    // Trail seeded with first file only; pool holds the other two.
    expect(result.current.playlist).toHaveLength(1)
    expect(result.current.playlist[0].path).toBe('/photos/a.jpg')
    expect(result.current.index).toBe(0)
  })

  it('sets scanning=false when onMediaDone fires', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    expect(result.current.scanning).toBe(true)
    act(() => { onMediaDoneCb?.({ totalMatches: 0, durationMs: 10 }) })
    expect(result.current.scanning).toBe(false)
  })

  it('next walks the pool into the trail; prev walks back along the trail; both clamp at boundaries', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    // Trail seeded with /a.jpg; pool holds /b.jpg + /c.jpg.
    expect(result.current.index).toBe(0)
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg'])

    // Shuffle defaults to false (config mock), so picks are FIFO.
    act(() => result.current.next())
    expect(result.current.index).toBe(1)
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/b.jpg'])

    act(() => result.current.next())
    expect(result.current.index).toBe(2)
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/b.jpg', '/c.jpg'])

    // Pool exhausted — next is a no-op.
    act(() => result.current.next())
    expect(result.current.index).toBe(2)
    expect(result.current.playlist).toHaveLength(3)

    act(() => result.current.prev())
    expect(result.current.index).toBe(1)
    act(() => result.current.prev())
    expect(result.current.index).toBe(0)
    // prev at 0 is a no-op.
    act(() => result.current.prev())
    expect(result.current.index).toBe(0)
  })

  it('toggling shuffle mid-walk does not modify the trail (history is frozen)', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: Array.from({ length: 5 }, (_, i) => ({
        path: `/f${i}.jpg`, size: 0, mtime: 0, type: 'image',
      })) })
    })
    // Walk forward twice — trail now has 3 entries.
    act(() => result.current.next())
    act(() => result.current.next())
    const playlistBefore = result.current.playlist
    const indexBefore    = result.current.index
    act(() => result.current.toggleShuffle())
    // playlist reference is identical (no re-derivation); index unchanged.
    expect(result.current.playlist).toBe(playlistBefore)
    expect(result.current.index).toBe(indexBefore)
  })

  it('toggleShuffle does not modify playlist regardless of the direction it is toggled', async () => {
    window.winraid = createWinraidMock({
      config: { get: vi.fn().mockResolvedValue({ recursive: false, shuffle: true }) },
      remote: {
        mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
        mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
        onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => { onMediaFoundCb = null } }),
        onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => { onMediaDoneCb  = null } }),
        onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => { onMediaErrorCb = null } }),
      },
    })
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: Array.from({ length: 5 }, (_, i) => ({
        path: `/f${i}.jpg`, size: 0, mtime: 0, type: 'image',
      })) })
    })
    const playlistRef = result.current.playlist
    act(() => result.current.toggleShuffle())  // true -> false
    expect(result.current.playlist).toBe(playlistRef)
    act(() => result.current.toggleShuffle())  // false -> true
    expect(result.current.playlist).toBe(playlistRef)
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

  it('retry() triggers a new mediaScan', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
    act(() => { result.current.retry() })
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(2)
  })

  it('exposes the trail+pool return shape; no `files` or `setIndex` fields', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    const r = result.current
    expect(Array.isArray(r.playlist)).toBe(true)
    expect(typeof r.index).toBe('number')
    expect(typeof r.scanning).toBe('boolean')
    expect(typeof r.hasMore).toBe('boolean')
    expect(typeof r.recursive).toBe('boolean')
    expect(typeof r.toggleRecursive).toBe('function')
    expect(typeof r.shuffle).toBe('boolean')
    expect(typeof r.toggleShuffle).toBe('function')
    expect(typeof r.next).toBe('function')
    expect(typeof r.prev).toBe('function')
    expect(typeof r.retry).toBe('function')
    expect(r.error).toBeNull()
    // The new model exposes neither `files` (replaced by trail/pool internals)
    // nor `setIndex` (exposing it would let a caller jump to a file the user
    // hasn't walked to, violating the trail invariant).
    expect(r).not.toHaveProperty('files')
    expect(r).not.toHaveProperty('setIndex')
  })

  it('sequential mode (shuffle off) picks pool files in FIFO arrival order', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/d.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    act(() => result.current.next())
    act(() => result.current.next())
    act(() => result.current.next())
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'])
  })

  it('shuffle mode (shuffle on) picks pool files via Math.random, not in arrival order', async () => {
    window.winraid = createWinraidMock({
      config: { get: vi.fn().mockResolvedValue({ recursive: false, shuffle: true }) },
      remote: {
        mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
        mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
        onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => { onMediaFoundCb = null } }),
        onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => { onMediaDoneCb  = null } }),
        onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => { onMediaErrorCb = null } }),
      },
    })
    // Force Math.random to always return 0.999 — randomPick picks the last
    // index of the pool array each time.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    try {
      const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
      await act(async () => {})
      act(() => {
        onMediaFoundCb?.({ files: [
          { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
        ] })
      })
      // /a.jpg seeded into trail. Pool is [/b.jpg, /c.jpg].
      // Math.random=0.999 → randomPick picks index pool.length-1 → /c.jpg.
      act(() => result.current.next())
      // Pool is now [/b.jpg]. Next pick = /b.jpg.
      act(() => result.current.next())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/c.jpg', '/b.jpg'])
    } finally {
      spy.mockRestore()
    }
  })

  it('prev from the initial file is a no-op and does not promote anything from the pool', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    expect(result.current.playlist).toHaveLength(1)
    act(() => result.current.prev())
    expect(result.current.index).toBe(0)
    expect(result.current.playlist).toHaveLength(1)
    expect(result.current.playlist[0].path).toBe('/a.jpg')
  })

  it('changing the path resets trail, pool, and index', async () => {
    const { result, rerender } = renderHook(
      ({ path }) => usePlayIndex('conn1', path),
      { initialProps: { path: '/photos' } }
    )
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/photos/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/photos/b.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    act(() => result.current.next())
    expect(result.current.playlist).toHaveLength(2)
    expect(result.current.index).toBe(1)

    rerender({ path: '/other' })
    await act(async () => {})
    // After the path change, the scan effect resubscribes — the new
    // onMediaFound callback is the one we capture in beforeEach.
    expect(result.current.playlist).toHaveLength(0)
    expect(result.current.index).toBe(0)

    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/other/x.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    expect(result.current.playlist).toHaveLength(1)
    expect(result.current.playlist[0].path).toBe('/other/x.jpg')
  })

  it('batches arriving after the first do not modify the trail or index', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg'])
    // next() with empty pool is a no-op.
    act(() => result.current.next())
    expect(result.current.index).toBe(0)
    // Now a second batch arrives.
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    // Trail and index are untouched; pool now has /b.jpg and /c.jpg.
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg'])
    expect(result.current.index).toBe(0)
    // Walking forward pulls from the freshly-arrived pool.
    act(() => result.current.next())
    expect(result.current.playlist).toHaveLength(2)
    expect(result.current.playlist[1].path).toBe('/b.jpg')
  })

  it('retry() resets trail/pool/index and triggers a new mediaScan', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    act(() => result.current.next())
    expect(result.current.playlist).toHaveLength(2)
    expect(result.current.index).toBe(1)
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)

    act(() => result.current.retry())
    await act(async () => {})

    expect(result.current.playlist).toHaveLength(0)
    expect(result.current.index).toBe(0)
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(2)
  })

  it('sequential mode picks the alphabetic successor of the current trail tip, not pool[0], after a shuffle pick has moved the cursor mid-alphabet', async () => {
    window.winraid = createWinraidMock({
      config: { get: vi.fn().mockResolvedValue({ recursive: false, shuffle: true }) },
      remote: {
        mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
        mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
        onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => { onMediaFoundCb = null } }),
        onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => { onMediaDoneCb  = null } }),
        onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => { onMediaErrorCb = null } }),
      },
    })
    // Math.random=0.5 in a 4-element pool → Math.floor(0.5 * 4) = 2 → pool[2].
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
      await act(async () => {})
      act(() => {
        onMediaFoundCb?.({ files: [
          { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/d.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/e.jpg', size: 0, mtime: 0, type: 'image' },
        ] })
      })
      // Trail = [/a.jpg]; pool = [/b, /c, /d, /e]. randomPick at idx 2 → /d.
      act(() => result.current.next())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/d.jpg'])
      // Switch to sequential. Successor of /d in pool [/b, /c, /e] is /e.
      // (pool[0] = /b would be wrong — that is "behind" alphabetically.)
      act(() => result.current.toggleShuffle())
      act(() => result.current.next())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/d.jpg', '/e.jpg'])
    } finally {
      spy.mockRestore()
    }
  })

  it('startFile seeds the trail when provided, instead of waiting for the first scan emit', async () => {
    const seed = { path: '/photos/seed.jpg', size: 100, mtime: 0, type: 'image' }
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos', seed))
    await act(async () => {})
    // Trail is seeded immediately — no need to wait for an emit.
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/photos/seed.jpg'])
    expect(result.current.index).toBe(0)
  })

  it('dedups incoming files against the trail (so a startFile is not duplicated when the new scan also emits it)', async () => {
    const seed = { path: '/photos/m.jpg', size: 100, mtime: 0, type: 'image' }
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos', seed))
    await act(async () => {})
    // The new scan emits files including the seed file.
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/photos/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/photos/m.jpg', size: 0, mtime: 0, type: 'image' },  // same as seed
        { path: '/photos/z.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    // Trail still just the seed.
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/photos/m.jpg'])
    // Pool has the other two emits, but NOT a duplicate of /photos/m.jpg.
    // (Indirect check: walk forward and confirm we never see /photos/m.jpg again.)
    act(() => result.current.next())
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/photos/m.jpg', '/photos/z.jpg'])
    act(() => result.current.next())
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/photos/m.jpg', '/photos/z.jpg', '/photos/a.jpg'])
    // Pool exhausted.
    act(() => result.current.next())
    expect(result.current.index).toBe(2)
    expect(result.current.playlist).toHaveLength(3)
  })

  it('changing startFile resets state and re-seeds with the new startFile', async () => {
    const seedA = { path: '/photos/a.jpg', size: 0, mtime: 0, type: 'image' }
    const seedB = { path: '/photos/b.jpg', size: 0, mtime: 0, type: 'image' }
    const { result, rerender } = renderHook(
      ({ s }) => usePlayIndex('conn1', '/photos', s),
      { initialProps: { s: seedA } }
    )
    await act(async () => {})
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/photos/a.jpg'])

    rerender({ s: seedB })
    await act(async () => {})
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/photos/b.jpg'])
    expect(result.current.index).toBe(0)
  })

  it('toggling shuffle while back in the trail truncates forward history and returns those files to the pool', async () => {
    window.winraid = createWinraidMock({
      config: { get: vi.fn().mockResolvedValue({ recursive: false, shuffle: true }) },
      remote: {
        mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
        mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
        onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => { onMediaFoundCb = null } }),
        onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => { onMediaDoneCb  = null } }),
        onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => { onMediaErrorCb = null } }),
      },
    })
    // Math.random=0.999 → randomPick lands on last index of the pool each call.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    try {
      const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
      await act(async () => {})
      act(() => {
        onMediaFoundCb?.({ files: [
          { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/d.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/e.jpg', size: 0, mtime: 0, type: 'image' },
        ] })
      })
      // Trail=[/a]; pool=[/b,/c,/d,/e]. Random pick at idx 3 → /e.
      act(() => result.current.next())
      // Trail=[/a,/e]; pool=[/b,/c,/d]. Random pick at idx 2 → /d.
      act(() => result.current.next())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/e.jpg', '/d.jpg'])
      // Go back to /a.
      act(() => result.current.prev())
      act(() => result.current.prev())
      expect(result.current.index).toBe(0)
      // Trail still intact while just walking back.
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/e.jpg', '/d.jpg'])
      // Toggle to sequential. Trail truncates to [/a]; /e and /d are returned to pool.
      act(() => result.current.toggleShuffle())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg'])
      expect(result.current.index).toBe(0)
      // Sequential pick: alphabetic successor of /a in restored pool = /b.
      act(() => result.current.next())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/b.jpg'])
    } finally {
      spy.mockRestore()
    }
  })

  it('toggling shuffle at the trail tip does NOT truncate (history-frozen rule still applies when there is no forward path to fork)', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    // Walk forward twice — at the trail tip now.
    act(() => result.current.next())
    act(() => result.current.next())
    expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/b.jpg', '/c.jpg'])
    expect(result.current.index).toBe(2)
    const beforeToggle = result.current.playlist
    act(() => result.current.toggleShuffle())
    // No truncation — we are at the tip, there is no forward path to discard.
    expect(result.current.playlist).toBe(beforeToggle)
    expect(result.current.index).toBe(2)
  })

  it('sequential mode wraps to the alphabetic smallest pool file when nothing remains after the current tip', async () => {
    window.winraid = createWinraidMock({
      config: { get: vi.fn().mockResolvedValue({ recursive: false, shuffle: true }) },
      remote: {
        mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
        mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
        onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => { onMediaFoundCb = null } }),
        onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => { onMediaDoneCb  = null } }),
        onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => { onMediaErrorCb = null } }),
      },
    })
    // Math.random=0.999 → last index of a 2-element pool.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    try {
      const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
      await act(async () => {})
      act(() => {
        onMediaFoundCb?.({ files: [
          { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
          { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
        ] })
      })
      // Trail = [/a]; pool = [/b, /c]. randomPick at idx 1 → /c.
      act(() => result.current.next())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/c.jpg'])
      // Switch to sequential. Nothing in pool > /c (pool is [/b]). Wrap to /b.
      act(() => result.current.toggleShuffle())
      act(() => result.current.next())
      expect(result.current.playlist.map((f) => f.path)).toEqual(['/a.jpg', '/c.jpg', '/b.jpg'])
    } finally {
      spy.mockRestore()
    }
  })

  it('hasMore is true while the pool has files or the scan is still running, false once both are exhausted', async () => {
    const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
    await act(async () => {})
    // Scanning, pool empty — hasMore is true (more might arrive).
    expect(result.current.scanning).toBe(true)
    expect(result.current.hasMore).toBe(true)
    // First batch arrives; one file becomes the trail, two go to the pool.
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/b.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/c.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    // Pool has files — hasMore is true.
    expect(result.current.hasMore).toBe(true)
    // Scan completes. Pool still has 2 files (we haven't walked).
    act(() => { onMediaDoneCb?.({ totalMatches: 3, durationMs: 10 }) })
    expect(result.current.scanning).toBe(false)
    expect(result.current.hasMore).toBe(true)
    // Walk forward, draining the pool.
    act(() => result.current.next())
    expect(result.current.hasMore).toBe(true)  // still one file in pool
    act(() => result.current.next())
    // Pool now empty AND not scanning — hasMore is false.
    expect(result.current.hasMore).toBe(false)
  })

})
