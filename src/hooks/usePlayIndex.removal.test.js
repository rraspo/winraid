import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayIndex } from './usePlayIndex'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the play queue can drop files and re-path files
// without a rescan, so the wall reflects a delete or a move the moment it
// succeeds:
//   - removePaths(paths): every entry whose path is listed leaves both the
//     trail and the pool; the viewer index follows the file that came after
//     the removed one, or the previous file when the removed one was last;
//     unknown paths are ignored; the call is a no-op when nothing matches
//   - relocatePaths(pairs: [{ from, to }]): entries keep their place, size,
//     mtime and type but carry the new path; unknown froms are ignored
// Both are stable callbacks (same identity across renders) like next/prev.

let onMediaFoundCb = null

beforeEach(() => {
  onMediaFoundCb = null
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockResolvedValue({ recursive: false, shuffle: false }),
    },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => { onMediaFoundCb = null } }),
      onMediaDone:  vi.fn().mockReturnValue(() => {}),
      onMediaError: vi.fn().mockReturnValue(() => {}),
    },
  })
})

afterEach(() => {
  delete window.winraid
})

function file(path) {
  return { path, size: 100, mtime: 42, type: 'image' }
}

// Emits a..e, then walks the first `walked` of them into the trail so the
// rest sit in the pool. Sequential mode keeps the order predictable.
async function mountWalked(walked) {
  const { result } = renderHook(() => usePlayIndex('conn1', '/photos'))
  await act(async () => {})
  act(() => {
    onMediaFoundCb?.({ files: ['a', 'b', 'c', 'd', 'e'].map((name) => file(`/photos/${name}.jpg`)) })
  })
  act(() => { result.current.fill(walked - 1) })
  return result
}

function trailPaths(result) {
  return result.current.playlist.map((entry) => entry.path)
}

describe('usePlayIndex removePaths', () => {
  it('drops a walked file from the trail and keeps the pool count', async () => {
    const result = await mountWalked(3)
    expect(trailPaths(result)).toEqual(['/photos/a.jpg', '/photos/b.jpg', '/photos/c.jpg'])
    expect(result.current.poolSize).toBe(2)
    act(() => { result.current.removePaths(['/photos/b.jpg']) })
    expect(trailPaths(result)).toEqual(['/photos/a.jpg', '/photos/c.jpg'])
    expect(result.current.poolSize).toBe(2)
  })

  it('drops an unwalked file from the pool so it can never be promoted', async () => {
    const result = await mountWalked(1)
    act(() => { result.current.removePaths(['/photos/b.jpg', '/photos/c.jpg']) })
    expect(result.current.poolSize).toBe(2)
    act(() => { result.current.fill(10) })
    expect(trailPaths(result)).toEqual(['/photos/a.jpg', '/photos/d.jpg', '/photos/e.jpg'])
  })

  it('removing the current file lands the index on the file that followed it', async () => {
    const result = await mountWalked(4)
    act(() => { result.current.goTo(1) })
    act(() => { result.current.removePaths(['/photos/b.jpg']) })
    expect(result.current.index).toBe(1)
    expect(result.current.playlist[result.current.index].path).toBe('/photos/c.jpg')
  })

  it('removing the current file when it is last lands the index on the previous file', async () => {
    const result = await mountWalked(3)
    act(() => { result.current.goTo(2) })
    act(() => { result.current.removePaths(['/photos/c.jpg']) })
    expect(result.current.index).toBe(1)
    expect(result.current.playlist[result.current.index].path).toBe('/photos/b.jpg')
  })

  it('removing files before the current one keeps the same file current', async () => {
    const result = await mountWalked(4)
    act(() => { result.current.goTo(3) })
    act(() => { result.current.removePaths(['/photos/a.jpg', '/photos/c.jpg']) })
    expect(trailPaths(result)).toEqual(['/photos/b.jpg', '/photos/d.jpg'])
    expect(result.current.index).toBe(1)
    expect(result.current.playlist[result.current.index].path).toBe('/photos/d.jpg')
  })

  it('removing files after the current one leaves the index untouched', async () => {
    const result = await mountWalked(4)
    act(() => { result.current.goTo(1) })
    act(() => { result.current.removePaths(['/photos/c.jpg', '/photos/d.jpg']) })
    expect(trailPaths(result)).toEqual(['/photos/a.jpg', '/photos/b.jpg'])
    expect(result.current.index).toBe(1)
  })

  it('removing every walked file empties the trail with index 0', async () => {
    const result = await mountWalked(2)
    act(() => { result.current.removePaths(['/photos/a.jpg', '/photos/b.jpg']) })
    expect(result.current.playlist).toEqual([])
    expect(result.current.index).toBe(0)
    expect(result.current.poolSize).toBe(3)
  })

  it('ignores paths it does not hold and returns the same state object', async () => {
    const result = await mountWalked(2)
    const before = result.current.playlist
    act(() => { result.current.removePaths(['/photos/nope.jpg']) })
    expect(result.current.playlist).toBe(before)
  })

  it('a removed path can be found again by a later scan batch', async () => {
    const result = await mountWalked(2)
    act(() => { result.current.removePaths(['/photos/b.jpg']) })
    act(() => { onMediaFoundCb?.({ files: [file('/photos/b.jpg')] }) })
    expect(result.current.poolSize).toBe(4)
  })

  it('is a stable callback', async () => {
    const result = await mountWalked(2)
    const first = result.current.removePaths
    act(() => { result.current.next() })
    expect(result.current.removePaths).toBe(first)
  })
})

describe('usePlayIndex relocatePaths', () => {
  it('re-paths a walked file in place, keeping its position and metadata', async () => {
    const result = await mountWalked(3)
    act(() => { result.current.relocatePaths([{ from: '/photos/b.jpg', to: '/photos/keep/b.jpg' }]) })
    expect(trailPaths(result)).toEqual(['/photos/a.jpg', '/photos/keep/b.jpg', '/photos/c.jpg'])
    expect(result.current.playlist[1]).toEqual({ path: '/photos/keep/b.jpg', size: 100, mtime: 42, type: 'image' })
  })

  it('re-paths an unwalked file in the pool', async () => {
    const result = await mountWalked(1)
    act(() => { result.current.relocatePaths([{ from: '/photos/e.jpg', to: '/photos/keep/e.jpg' }]) })
    act(() => { result.current.fill(10) })
    expect(trailPaths(result)).toContain('/photos/keep/e.jpg')
    expect(trailPaths(result)).not.toContain('/photos/e.jpg')
  })

  it('keeps the index and the current file across a relocation of the current file', async () => {
    const result = await mountWalked(3)
    act(() => { result.current.goTo(2) })
    act(() => { result.current.relocatePaths([{ from: '/photos/c.jpg', to: '/photos/keep/c.jpg' }]) })
    expect(result.current.index).toBe(2)
    expect(result.current.playlist[2].path).toBe('/photos/keep/c.jpg')
  })

  it('ignores froms it does not hold and returns the same state object', async () => {
    const result = await mountWalked(2)
    const before = result.current.playlist
    act(() => { result.current.relocatePaths([{ from: '/photos/nope.jpg', to: '/photos/x.jpg' }]) })
    expect(result.current.playlist).toBe(before)
  })

  it('is a stable callback', async () => {
    const result = await mountWalked(2)
    const first = result.current.relocatePaths
    act(() => { result.current.next() })
    expect(result.current.relocatePaths).toBe(first)
  })
})
