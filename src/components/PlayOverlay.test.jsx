import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import PlayOverlay, { WALL_PAGE_SIZE } from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'
import * as toast from '../services/toast'

// Contract under test — the Play overlay is a scrollable masonry wall of
// every file the media scan finds, in queue order (shuffle or sequential),
// paged from the pool. Clicking a tile opens that file in the Quick Look
// viewer, which walks the same order and carries every editing tool Quick
// Look has. Escape, the Close button, or a right-click in the viewer return
// to the wall exactly as it was left (same tiles, same scroll, no rescan).
//
// DOM contract the implementation must honor:
//   - root: role="dialog" aria-label="Play"
//   - props: { connectionId, path, onClose, remoteBasePath, canServerEdit, onMutated }
//     onMutated({ paths }) fires after every mutation Play performs itself,
//     with the remote paths it touched, so the browse view can refresh
//   - wall scroll container: data-testid="play-wall"
//   - one tile per walked file, in trail order:
//       <button aria-label="Open <basename>" data-type="image|video">
//       image tiles contain an <img> whose src is the thumb URL (?thumb=1)
//   - bottom sentinel: data-testid="play-wall-sentinel", observed with an
//     IntersectionObserver; intersecting requests another page
//   - viewer: data-testid="play-viewer" wrapping a Quick Look dialog
//     (role="dialog" aria-label="Quick Look: <basename>") whose "Next file"
//     and "Previous file" controls and arrow keys walk the wall order, and
//     whose Next stays enabled at the wall's tip while the queue has more
//   - no half-screen tap zones over the media
//   - WALL_PAGE_SIZE: exported page length, at least 12

vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

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
  toast.clearAll()
  delete window.winraid
})

function setup({ shuffle = false, recursive = true, remote = {} } = {}) {
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
      ...remote,
    },
  })
}

const defaultProps = {
  connectionId: 'c1',
  path: '/photos',
  onClose: vi.fn(),
  remoteBasePath: '/photos',
  canServerEdit: true,
  onMutated: vi.fn(),
}

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

function tileImageSrc(name) {
  return screen.getByRole('button', { name: `Open ${name}` }).querySelector('img').getAttribute('src')
}

function wall() {
  return screen.getByTestId('play-wall')
}

function viewer() {
  return screen.queryByTestId('play-viewer')
}

function viewerDialog() {
  return within(viewer()).getByRole('dialog', { name: /^Quick Look: / })
}

function viewerImageSrc() {
  return viewer().querySelector('img').getAttribute('src')
}

async function mount(props = defaultProps) {
  const utils = render(<PlayOverlay {...props} />)
  await act(async () => {})
  return utils
}

async function open(name) {
  fireEvent.click(screen.getByRole('button', { name: `Open ${name}` }))
  await act(async () => {})
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
    await open('clip.mp4')
    const player = viewer().querySelector('video')
    expect(player).toBeTruthy()
    expect(player.getAttribute('src')).toBe('nas-stream://c1/photos/clip.mp4')
    expect(viewer().querySelector('img')).toBeNull()
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
  it('clicking a tile opens that file in a Quick Look dialog over the wall', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    await open('b.jpg')
    expect(viewer()).toBeTruthy()
    expect(viewerDialog().getAttribute('aria-label')).toBe('Quick Look: b.jpg')
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
  })

  it('opening a tile does not start a new scan', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    await open('b.jpg')
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
    expect(window.winraid.remote.mediaCancel).not.toHaveBeenCalled()
  })

  it('offers the image editing tools for an image', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg')])
    await open('a.jpg')
    expect(within(viewer()).getByLabelText('Rotate image')).toBeTruthy()
    expect(within(viewer()).getByLabelText('Crop image')).toBeTruthy()
    expect(within(viewer()).getByLabelText('More actions')).toBeTruthy()
  })

  it('offers the video editing tools for a video when the server can edit', async () => {
    setup()
    await mount({ ...defaultProps, canServerEdit: true })
    emit([video('/photos/clip.mp4')])
    await open('clip.mp4')
    expect(within(viewer()).getByLabelText('Trim video')).toBeTruthy()
    expect(within(viewer()).getByLabelText('Rotate video')).toBeTruthy()
    expect(within(viewer()).getByLabelText('Crop video')).toBeTruthy()
    expect(within(viewer()).getByLabelText('Save video snapshot')).toBeTruthy()
  })

  it('hides the server-side video tools when the server cannot edit', async () => {
    setup()
    await mount({ ...defaultProps, canServerEdit: false })
    emit([video('/photos/clip.mp4')])
    await open('clip.mp4')
    expect(within(viewer()).queryByLabelText('Trim video')).toBeNull()
    expect(within(viewer()).queryByLabelText('Rotate video')).toBeNull()
    expect(within(viewer()).queryByLabelText('Crop video')).toBeNull()
  })

  it('the viewer video keeps its native controls with nothing covering it', async () => {
    setup()
    await mount()
    emit([video('/photos/clip.mp4')])
    await open('clip.mp4')
    const player = viewer().querySelector('video')
    expect(player.hasAttribute('controls')).toBe(true)
    expect(within(viewer()).queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(within(viewer()).queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('Next file and Previous file walk the wall order from the opened tile', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    await open('b.jpg')
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Next file' }))
    expect(viewerImageSrc()).toContain('/photos/c.jpg')
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Previous file' }))
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Previous file' }))
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
    expect(within(viewer()).getByRole('button', { name: 'Previous file' })).toBeDisabled()
  })

  it('ArrowRight and ArrowLeft walk the wall order exactly one step per press', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    await open('a.jpg')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
  })

  it('shows the position within the walked wall', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    act(() => { onMediaDoneCb?.({ totalMatches: 3, durationMs: 10 }) })
    await open('b.jpg')
    expect(within(viewer()).getByText('2 / 3')).toBeTruthy()
  })

  it('Next at the wall tip stays enabled while the queue has more and pulls the next file', async () => {
    setup()
    await mount()
    emit(manyImages(WALL_PAGE_SIZE + 3))
    const last = tilePaths()[WALL_PAGE_SIZE - 1]
    await open(last)
    const nextButton = within(viewer()).getByRole('button', { name: 'Next file' })
    expect(nextButton).not.toBeDisabled()
    fireEvent.click(nextButton)
    const shown = viewerImageSrc()
    expect(shown).not.toContain(last)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE + 1)
    expect(shown).toContain(tilePaths()[WALL_PAGE_SIZE])
  })

  it('Next at the last file is disabled once the scan is done and the pool is empty', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    act(() => { onMediaDoneCb?.({ totalMatches: 2, durationMs: 10 }) })
    await open('b.jpg')
    expect(within(viewer()).getByRole('button', { name: 'Next file' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
  })

  it('right-click in the viewer returns to the wall and suppresses the native menu', async () => {
    setup()
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    await open('a.jpg')
    const notPrevented = fireEvent.contextMenu(viewer().querySelector('img'))
    expect(notPrevented).toBe(false)
    expect(viewer()).toBeNull()
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg'])
  })

  it('Escape in the viewer returns to the wall without closing the overlay', async () => {
    const onClose = vi.fn()
    setup()
    await mount({ ...defaultProps, onClose })
    emit([image('/photos/a.jpg')])
    await open('a.jpg')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(viewer()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the Close button in the viewer returns to the wall without closing the overlay', async () => {
    const onClose = vi.fn()
    setup()
    await mount({ ...defaultProps, onClose })
    emit([image('/photos/a.jpg')])
    await open('a.jpg')
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Close' }))
    expect(viewer()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('returning to the wall keeps the same wall node, scroll position and queue, with no rescan', async () => {
    setup()
    await mount()
    emit(manyImages(WALL_PAGE_SIZE))
    const wallBefore = wall()
    const before = tilePaths()
    wallBefore.scrollTop = 480
    await open(before[3])
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
    await open('a.jpg')
    fireEvent.keyDown(window, { key: 'Escape' })
    await open('c.jpg')
    expect(viewerImageSrc()).toContain('/photos/c.jpg')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(viewerImageSrc()).toContain('/photos/b.jpg')
  })

  it('an in-place edit in the viewer refreshes that tile on the wall', async () => {
    const context = { drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn() }
    const canvasMock = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback, mime) => callback(new Blob(['pixels'], { type: mime ?? 'image/jpeg' }))),
    }
    const originalCreateElement = document.createElement.bind(document)
    document.createElement = (tag) => (tag === 'canvas' ? canvasMock : originalCreateElement(tag))
    try {
      const writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
      setup({ remote: { writeFileBinary } })
      await mount()
      emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
      const srcBefore = tileImageSrc('a.jpg')
      await open('a.jpg')
      fireEvent.click(within(viewer()).getByLabelText('Rotate image'))
      await act(async () => {})
      const sourceImg = document.querySelector('.rotateSourceImage')
      expect(sourceImg).not.toBeNull()
      Object.defineProperty(sourceImg, 'naturalWidth',  { configurable: true, value: 800 })
      Object.defineProperty(sourceImg, 'naturalHeight', { configurable: true, value: 600 })
      fireEvent.load(sourceImg)
      await waitFor(() => expect(writeFileBinary).toHaveBeenCalledWith('c1', '/photos/a.jpg', expect.anything(), { atomic: true }))
      await waitFor(() => expect(window.winraid.cache.invalidateFile).toHaveBeenCalledWith('c1', '/photos/a.jpg'))
      fireEvent.keyDown(window, { key: 'Escape' })
      await waitFor(() => expect(tileImageSrc('a.jpg')).not.toBe(srcBefore))
      expect(tileImageSrc('a.jpg')).toMatch(/^nas-stream:\/\/c1\/photos\/a\.jpg\?thumb=1/)
      expect(tileImageSrc('b.jpg')).toMatch(/^nas-stream:\/\/c1\/photos\/b\.jpg\?thumb=1$/)
    } finally {
      document.createElement = originalCreateElement
    }
  })
})

// The viewer shows the open file's folder path as breadcrumbs under the
// file name, the way the old Play viewer did. Clicking a segment makes that
// folder the new scan root: the queue rebuilds from a fresh scan there with
// the same settings, seeded with the file that was open so it stays the
// first tile, and the viewer closes onto the new wall. The segment that is
// the current scan root carries aria-current and is inert.
describe('PlayOverlay viewer breadcrumbs', () => {
  const nested = image('/photos/2025/vacation/img.jpg')

  function crumb(label) {
    return within(viewer()).getByRole('button', { name: label })
  }

  it('shows the open file folder as breadcrumbs with the scan root marked current', async () => {
    setup()
    await mount()
    emit([nested])
    await open('img.jpg')
    expect(crumb('/')).toBeTruthy()
    expect(crumb('photos').getAttribute('aria-current')).toBe('true')
    expect(crumb('2025').hasAttribute('aria-current')).toBe(false)
    expect(crumb('vacation').hasAttribute('aria-current')).toBe(false)
    expect(within(viewer()).getByRole('button', { name: 'img.jpg' })).toBeTruthy()
  })

  it('clicking a deeper folder rescans there, seeds the wall with the open file, and closes the viewer', async () => {
    setup()
    await mount()
    emit([nested, image('/photos/other.jpg')])
    await open('img.jpg')
    fireEvent.click(crumb('2025'))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenLastCalledWith('c1', '/photos/2025', { recursive: true })
    expect(viewer()).toBeNull()
    expect(tilePaths()).toEqual(['img.jpg'])
    emit([image('/photos/2025/spring.jpg'), nested])
    expect(tilePaths()).toEqual(['img.jpg', 'spring.jpg'])
    expect(screen.getByRole('button', { name: '2025' }).getAttribute('aria-current')).toBe('true')
  })

  it('clicking a folder above the scan root widens the scope the same way', async () => {
    setup()
    await mount()
    emit([nested])
    await open('img.jpg')
    fireEvent.click(crumb('/'))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenLastCalledWith('c1', '/', { recursive: true })
    expect(viewer()).toBeNull()
    expect(tilePaths()).toEqual(['img.jpg'])
  })

  it('clicking the current scan root does nothing', async () => {
    setup()
    await mount()
    emit([nested])
    await open('img.jpg')
    fireEvent.click(crumb('photos'))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
    expect(viewer()).toBeTruthy()
  })

  it('keeps the shuffle setting across the rescan', async () => {
    setup({ shuffle: true })
    await mount()
    emit([nested])
    await open('img.jpg')
    fireEvent.click(crumb('2025'))
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Toggle shuffle' }).getAttribute('aria-pressed')).toBe('true')
    expect(window.winraid.remote.mediaScan).toHaveBeenLastCalledWith('c1', '/photos/2025', { recursive: true })
  })
})

// Deleting from the viewer happens inside Play: a confirmation, the remote
// delete, and the queue drops the file in place — the wall loses its tile,
// the viewer moves on to the file that followed, and Play stays open. The
// browse view only hears about it through onMutated.
describe('PlayOverlay viewer delete', () => {
  function requestDelete() {
    fireEvent.click(within(viewer()).getByLabelText('More actions'))
    fireEvent.click(within(viewer()).getByText('Delete'))
  }

  function confirmDelete() {
    return act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })
  }

  it('Delete from the viewer menu asks for confirmation inside Play, deleting nothing yet', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: true }) } })
    const onClose = vi.fn()
    await mount({ ...defaultProps, onClose })
    emit([image('/photos/a.jpg')])
    await open('a.jpg')
    requestDelete()
    const playDialog = screen.getByRole('dialog', { name: 'Play' })
    expect(within(playDialog).getByText('Delete file?')).toBeTruthy()
    expect(within(playDialog).getByText('a.jpg', { selector: 'strong' })).toBeTruthy()
    expect(window.winraid.remote.delete).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancel keeps the file, the viewer and the wall exactly as they were', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: true }) } })
    const onMutated = vi.fn()
    await mount({ ...defaultProps, onMutated })
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    await open('a.jpg')
    requestDelete()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Delete file?')).toBeNull()
    expect(window.winraid.remote.delete).not.toHaveBeenCalled()
    expect(onMutated).not.toHaveBeenCalled()
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg'])
  })

  it('confirming deletes the file remotely, drops its tile, and the viewer shows the next file', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: true }) } })
    const onMutated = vi.fn()
    const onClose   = vi.fn()
    await mount({ ...defaultProps, onMutated, onClose })
    emit([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    await open('b.jpg')
    requestDelete()
    await confirmDelete()
    expect(window.winraid.remote.delete).toHaveBeenCalledWith('c1', '/photos/b.jpg', false)
    expect(window.winraid.cache.invalidateFile).toHaveBeenCalledWith('c1', '/photos/b.jpg')
    expect(screen.queryByText('Delete file?')).toBeNull()
    expect(tilePaths()).toEqual(['a.jpg', 'c.jpg'])
    expect(viewer()).toBeTruthy()
    expect(viewerImageSrc()).toContain('/photos/c.jpg')
    expect(onMutated).toHaveBeenCalledWith({ paths: ['/photos/b.jpg'] })
    expect(onClose).not.toHaveBeenCalled()
    expect(window.winraid.remote.mediaScan).toHaveBeenCalledTimes(1)
  })

  it('deleting the last walked file moves the viewer back to the previous one', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: true }) } })
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    act(() => { onMediaDoneCb?.({ totalMatches: 2, durationMs: 10 }) })
    await open('b.jpg')
    requestDelete()
    await confirmDelete()
    expect(tilePaths()).toEqual(['a.jpg'])
    expect(viewer()).toBeTruthy()
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
  })

  it('deleting the only file returns to the wall, which shows the empty state, and Play stays open', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: true }) } })
    const onClose = vi.fn()
    await mount({ ...defaultProps, onClose })
    emit([image('/photos/a.jpg')])
    act(() => { onMediaDoneCb?.({ totalMatches: 1, durationMs: 10 }) })
    await open('a.jpg')
    requestDelete()
    await confirmDelete()
    expect(viewer()).toBeNull()
    expect(tiles()).toHaveLength(0)
    expect(screen.getByText('No media files found')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a deleted file at the wall tip is not refilled from thin air: the pool supplies the next page', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: true }) } })
    await mount()
    emit(manyImages(WALL_PAGE_SIZE + 1))
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE)
    await open('0003.jpg')
    requestDelete()
    await confirmDelete()
    // The wall tops itself back up to a full page from the pool, and the
    // deleted file is gone for good.
    expect(tiles()).toHaveLength(WALL_PAGE_SIZE)
    expect(tilePaths()).not.toContain('0003.jpg')
  })

  it('a failed delete keeps the file everywhere and reports the error', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: false, error: 'Permission denied' }) } })
    const onMutated = vi.fn()
    await mount({ ...defaultProps, onMutated })
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    await open('a.jpg')
    requestDelete()
    await confirmDelete()
    expect(screen.queryByText('Delete file?')).toBeNull()
    expect(tilePaths()).toEqual(['a.jpg', 'b.jpg'])
    expect(viewerImageSrc()).toContain('/photos/a.jpg')
    expect(onMutated).not.toHaveBeenCalled()
    expect(toast.getSnapshot().some((entry) => entry.type === 'error' && /Permission denied/.test(entry.msg))).toBe(true)
  })

  it('a successful delete confirms itself with a toast naming the file', async () => {
    setup({ remote: { delete: vi.fn().mockResolvedValue({ ok: true }) } })
    await mount()
    emit([image('/photos/a.jpg'), image('/photos/b.jpg')])
    await open('a.jpg')
    requestDelete()
    await confirmDelete()
    expect(toast.getSnapshot().some((entry) => entry.type === 'success' && /a\.jpg/.test(entry.msg))).toBe(true)
  })
})
