import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import PlayOverlay, { WALL_PAGE_SIZE } from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the Play overlay is a scrollable masonry wall of
// every file the media scan finds, in queue order (shuffle or sequential),
// paged from the pool. Clicking a tile opens that file whole in a viewer
// that walks the same order; right-click or Escape in the viewer returns
// to the wall exactly as it was left (same tiles, same scroll, no rescan).
//
// DOM contract the implementation must honor:
//   - root: role="dialog" aria-label="Play"
//   - wall scroll container: data-testid="play-wall"
//   - one tile per walked file, in trail order:
//       <button aria-label="Open <basename>" data-type="image|video">
//       image tiles contain an <img> whose src is the thumb URL (?thumb=1)
//   - bottom sentinel: data-testid="play-wall-sentinel", observed with an
//     IntersectionObserver; intersecting requests another page
//   - viewer: data-testid="play-viewer", holds the full-size <img> (alt =
//     basename) or <video>; hidden/unmounted while the wall is browsed
//   - WALL_PAGE_SIZE: exported page length, at least 12

let onMediaFoundCb = null
let onMediaDoneCb  = null
let onMediaErrorCb = null

const intersectionObservers = []
class IntersectionObserverStub {
  constructor(callback) {
    this.callback = callback
    this.targets  = new Set()
    intersectionObservers.push(this)
  }
  observe(el)   { this.targets.add(el) }
  unobserve(el) { this.targets.delete(el) }
  disconnect()  { this.targets.clear() }
  takeRecords() { return [] }
}
function intersect(el) {
  for (const observer of intersectionObservers) {
    if (observer.targets.has(el)) {
      observer.callback([{ isIntersecting: true, intersectionRatio: 1, target: el }], observer)
    }
  }
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let savedIntersectionObserver
let savedResizeObserver

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  savedResizeObserver       = window.ResizeObserver
  window.IntersectionObserver = IntersectionObserverStub
  window.ResizeObserver       = ResizeObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  globalThis.ResizeObserver       = ResizeObserverStub
  intersectionObservers.length = 0
})

afterEach(() => {
  window.IntersectionObserver     = savedIntersectionObserver
  window.ResizeObserver           = savedResizeObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  globalThis.ResizeObserver       = savedResizeObserver
  delete window.winraid
})

function setup({ shuffle = false, recursive = true } = {}) {
  onMediaFoundCb = null
  onMediaDoneCb  = null
  onMediaErrorCb = null
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({ recursive, shuffle }) },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => {} }),
      onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => {} }),
      onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => {} }),
    },
  })
}

const defaultProps = { connectionId: 'c1', path: '/photos', onClose: vi.fn() }

function image(path) { return { path, size: 100, mtime: 0, type: 'image' } }
function video(path) { return { path, size: 5000, mtime: 0, type: 'video' } }

function emit(files) {
  act(() => { onMediaFoundCb?.({ files }) })
}

function tiles() {
  return screen.queryAllByRole('button', { name: /^Open / })
}

function tilePaths() {
  return tiles().map((tile) => tile.getAttribute('aria-label').replace(/^Open /, ''))
}

function wall() {
  return screen.getByTestId('play-wall')
}

function viewer() {
  return screen.queryByTestId('play-viewer')
}

function viewerImageSrc() {
  return within(viewer()).getByRole('img').getAttribute('src')
}

async function mount(props = defaultProps) {
  const utils = render(<PlayOverlay {...props} />)
  await act(async () => {})
  return utils
}

function manyImages(count) {
  return Array.from({ length: count }, (_, i) => image(`/photos/${String(i).padStart(4, '0')}.jpg`))
}

describe('PlayOverlay wall', () => {
  it('renders the overlay as a dialog with a wall and no viewer', async () => {
    setup()
    await mount()
    expect(screen.getByRole('dialog', { name: 'Play' })).toBeTruthy()
    expect(wall()).toBeTruthy()
    expect(viewer()).toBeNull()
  })

  it('shows the scanning indicator until the scan completes', async () => {
    setup()
    await mount()
    expect(screen.getByLabelText('Scanning')).toBeTruthy()
    act(() => { onMediaDoneCb?.({ totalMatches: 0, durationMs: 10 }) })
    expect(screen.queryByLabelText('Scanning')).toBeNull()
  })

  it('shows the empty state when the scan completes with no files', async () => {
    setup()
    await mount()
    act(() => { onMediaDoneCb?.({ totalMatches: 0, durationMs: 10 }) })
    expect(screen.getByText('No media files found')).toBeTruthy()
    expect(tiles()).toHaveLength(0)
  })

  it('renders one tile per found file when a batch is smaller than a page', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('image tiles show the cached thumbnail, never the full-size stream', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg')])
    const [tile] = tiles()
    expect(tile.getAttribute('data-type')).toBe('image')
    const img = tile.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toMatch(/^nas-stream:\/\/c1\/photos\/a\.jpg\?thumb=1/)
  })

  it('video tiles are marked as video and open a player, not an image', async () => {
    setup()
    await mount()
    emit([video('/photos/clip.mp4')])
    const [tile] = tiles()
    expect(tile.getAttribute('data-type')).toBe('video')
    fireEvent.click(tile)
    const player = viewer().querySelector('video')
    expect(player).toBeTruthy()
    expect(player.getAttribute('src')).toBe('nas-stream://c1/photos/clip.mp4')
    expect(within(viewer()).queryByRole('img')).toBeNull()
  })

  it('keeps growing the wall as batches stream in below one page', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    expect(tiles()).toHaveLength(2)
    emit([image('/photos/c.jpg'), image('/photos/d.jpg'), image('/photos/e.jpg')])
    expect(tiles()).toHaveLength(5)
  })

  it('exports a page size of at least 12', () => {
    expect(WALL_PAGE_SIZE).toBeGreaterThanOrEqual(12)
  })

  it('fills exactly one page from a large batch and holds the rest in the pool', async () => {
    setup()
    await mount()
    emit(manyImages(WALL_PAGE_SIZE * 3))
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE)
  })

  it('pulls another page when the bottom sentinel comes into view', async () => {
    setup()
    await mount()
    emit(manyImages(WALL_PAGE_SIZE * 3))
    act(() => intersect(screen.getByTestId('play-wall-sentinel')))
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE * 2)
    act(() => intersect(screen.getByTestId('play-wall-sentinel')))
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE * 3)
  })

  it('stops paging quietly once the pool is drained and the scan is done', async () => {
    setup()
    await mount()
    emit(manyImages(WALL_PAGE_SIZE + 2))
    act(() => { onMediaDoneCb?.({ totalMatches: WALL_PAGE_SIZE + 2, durationMs: 10 }) })
    act(() => intersect(screen.getByTestId('play-wall-sentinel')))
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE + 2)
    act(() => intersect(screen.getByTestId('play-wall-sentinel')))
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE + 2)
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
  })

  it('sequential mode lays tiles out in alphabetic order after the seed', async () => {
    setup({ shuffle: false })
    await mount()
    // The first arrival seeds the trail (existing queue rule); everything
    // after it is promoted as the alphabetic successor of the tip.
    emit([image('/photos/c.jpg'), image('/photos/d.jpg'), image('/photos/a.jpg'), image('/photos/b.jpg')])
    expect(tilePaths()).toEqual(['c.jpg', 'd.jpg', 'a.jpg', 'b.jpg'])
  })

  it('shuffle mode promotes tiles through Math.random', async () => {
    setup({ shuffle: true })
    await mount()
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.999)
    try {
      emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg'), image('/photos/d.jpg')])
    } finally {
      spy.mockRestore()
    }
    expect(tilePaths()).toEqual(['a.jpg', 'd.jpg', 'c.jpg', 'b.jpg'])
  })

  it('renders the recursive, shuffle, fullscreen and close controls on the wall', async () => {
    setup()
    await mount()
    expect(screen.getByRole('button', { name: 'Toggle recursive scan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Toggle shuffle' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Toggle fullscreen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('toggling recursive restarts the scan and clears the wall', async () => {
    setup({ recursive: true })
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/sub/b.jpg')])
    expect(tiles()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recursive scan' }))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenLastCalledWith('c1', '/photos', { recursive: false })
    expect(tiles()).toHaveLength(0)
  })

  it('Escape on the wall closes the overlay', async () => {
    const onClose = vi.fn()
    setup()
    await mount({ ...defaultProps, onClose })
    emit([image('/photos/a.jpg')])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the close button closes the overlay', async () => {
    const onClose = vi.fn()
    setup()
    await mount({ ...defaultProps, onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('wheel and arrow keys on the wall never open the viewer or move the queue', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    fireEvent.wheel(window, { deltaY: 100 })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(viewer()).toBeNull()
    expect(tiles()).toHaveLength(2)
  })

  it('shows the scan error with a Retry that starts a new scan', async () => {
    setup()
    await mount()
    act(() => { onMediaErrorCb?.({ path: '/photos', code: 'EACCES', msg: 'Permission denied' }) })
    expect(screen.getByText('Permission denied')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(2)
  })

  it('shows the scan root as breadcrumbs; clicking a parent rescans there', async () => {
    setup()
    await mount({ ...defaultProps, path: '/photos/2025' })
    emit([image('/photos/2025/a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'photos' }))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenLastCalledWith('c1', '/photos', { recursive: true })
  })
})

describe('PlayOverlay viewer', () => {
  it('clicking a tile opens that file whole, in a viewer over the wall', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open b.jpg' }))
    expect(viewer()).toBeTruthy()
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
    expect(within(viewer()).getByRole('img').getAttribute('alt')).toBe('b.jpg')
  })

  it('opening a tile does not start a new scan', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open b.jpg' }))
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
    expect(window.winraid.remote.mediaCancel).not.toHaveBeenCalled()
  })

  it('ArrowRight and ArrowLeft walk the wall order from the opened tile', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open b.jpg' }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(viewerImageSrc()).toContain('/photos/c.jpg')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
  })

  it('wheel in the viewer walks forward and back', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg' }))
    fireEvent.wheel(window, { deltaY: 100 })
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
    fireEvent.wheel(window, { deltaY: -100 })
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
  })

  it('walking past the last tile pulls the next file from the pool and adds it to the wall', async () => {
    setup()
    await mount()
    emit(manyImages(WALL_PAGE_SIZE + 3))
    const last = tilePaths()[WALL_PAGE_SIZE - 1]
    fireEvent.click(screen.getByRole('button', { name: `Open ${last}` }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    const shown = viewerImageSrc()
    expect(shown).not.toContain(last)
    fireEvent.contextMenu(viewer())
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE + 1)
    expect(shown).toContain(tilePaths()[WALL_PAGE_SIZE])
  })

  it('shows the end marker at the last file once the scan is done', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    act(() => { onMediaDoneCb?.({ totalMatches: 2, durationMs: 10 }) })
    fireEvent.click(screen.getByRole('button', { name: 'Open b.jpg' }))
    expect(within(viewer()).getByText('End')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
  })

  it('right-click in the viewer returns to the wall and suppresses the native menu', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg' }))
    const notPrevented = fireEvent.contextMenu(within(viewer()).getByRole('img'))
    expect(notPrevented).toBe(false)
    expect(viewer()).toBeNull()
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg'])
  })

  it('Escape in the viewer returns to the wall without closing the overlay', async () => {
    const onClose = vi.fn()
    setup()
    await mount({ ...defaultProps, onClose })
    emit([image('/photos/a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(viewer()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the close button in the viewer closes the whole overlay', async () => {
    const onClose = vi.fn()
    setup()
    await mount({ ...defaultProps, onClose })
    emit([image('/photos/a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg' }))
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('returning to the wall keeps the same wall node, scroll position and queue, with no rescan', async () => {
    setup()
    await mount()
    emit(manyImages(WALL_PAGE_SIZE))
    const wallBefore = wall()
    const before = tilePaths()
    wallBefore.scrollTop = 480
    fireEvent.click(screen.getByRole('button', { name: `Open ${before[3]}` }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(wall()).toBe(wallBefore)
    expect(wall().scrollTop).toBe(480)
    expect(tilePaths()).toEqual(before)
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
    expect(window.winraid.remote.mediaCancel).not.toHaveBeenCalled()
  })

  it('reopening a different tile after returning shows that tile', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Open c.jpg' }))
    expect(viewerImageSrc()).toContain('/photos/c.jpg')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
  })

  it('a breadcrumb click in the viewer rescans there and keeps the open file until navigation', async () => {
    setup()
    await mount()
    emit([image('/photos/2025/vacation/img.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Open img.jpg' }))
    expect(window.winraid.remote.mediaScan).toHaveBeenLastCalledWith('c1', '/photos', { recursive: true })

    fireEvent.click(within(viewer()).getByRole('button', { name: '2025' }))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenLastCalledWith('c1', '/photos/2025', { recursive: true })
    expect(viewerImageSrc()).toContain('img.jpg')

    emit([image('/photos/2025/spring.jpg')])
    expect(viewerImageSrc()).toContain('img.jpg')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(viewerImageSrc()).toContain('spring.jpg')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(tilePaths()).toEqual(['img.jpg', 'spring.jpg'])
  })
})
