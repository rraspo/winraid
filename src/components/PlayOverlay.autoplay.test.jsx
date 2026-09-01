import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import PlayOverlay from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — wall tiles play by themselves while they are on
// screen. A video tile mounts a muted, looping, autoplaying player only
// while it intersects the viewport and drops it again when it leaves or
// when the viewer covers the wall. An animated gif tile shows the real gif
// stream instead of the static cached thumbnail. The viewer is unchanged:
// it keeps its player with sound and controls.
//
// DOM contract additions on top of PlayOverlay.test.jsx:
//   - a video tile (button[data-type="video"]) contains a <video> only
//     while in view; that element carries muted, loop, autoplay and
//     playsinline, its src is the plain stream URL, and play() is invoked
//   - the tile's player reports its ratio through loadedmetadata so the
//     tile takes the video's real proportions
//   - gif tiles use the plain stream URL as their <img> src (no thumb=1)
//   - no wall <video> stays mounted while the viewer is open

let onMediaFoundCb = null

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
// Fires every observer that watches the element itself or anything inside
// it, so the test does not care which node the tile chose to observe.
function setInView(container, isIntersecting) {
  for (const observer of intersectionObservers) {
    for (const target of observer.targets) {
      if (container === target || container.contains(target)) {
        observer.callback([{ isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, target }], observer)
      }
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
let savedPlay
let savedPause
let playSpy
let pauseSpy

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  savedResizeObserver       = window.ResizeObserver
  window.IntersectionObserver     = IntersectionObserverStub
  window.ResizeObserver           = ResizeObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  globalThis.ResizeObserver       = ResizeObserverStub
  intersectionObservers.length = 0

  savedPlay  = window.HTMLMediaElement.prototype.play
  savedPause = window.HTMLMediaElement.prototype.pause
  playSpy  = vi.fn(() => Promise.resolve())
  pauseSpy = vi.fn()
  window.HTMLMediaElement.prototype.play  = playSpy
  window.HTMLMediaElement.prototype.pause = pauseSpy

  onMediaFoundCb = null
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({ recursive: true, shuffle: false }) },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => {} }),
      onMediaDone:  vi.fn().mockReturnValue(() => {}),
      onMediaError: vi.fn().mockReturnValue(() => {}),
    },
  })
})

afterEach(() => {
  window.IntersectionObserver     = savedIntersectionObserver
  window.ResizeObserver           = savedResizeObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  globalThis.ResizeObserver       = savedResizeObserver
  window.HTMLMediaElement.prototype.play  = savedPlay
  window.HTMLMediaElement.prototype.pause = savedPause
  delete window.winraid
})

const defaultProps = { connectionId: 'c1', path: '/photos', onClose: vi.fn() }

function image(path) { return { path, size: 100, mtime: 0, type: 'image' } }
function video(path) { return { path, size: 5000, mtime: 0, type: 'video' } }

function emit(files) {
  act(() => { onMediaFoundCb?.({ files }) })
}

async function mount() {
  const utils = render(<PlayOverlay {...defaultProps} />)
  await act(async () => {})
  return utils
}

function tile(name) {
  return screen.getByRole('button', { name: `Open ${name}` })
}

function wall() {
  return screen.getByTestId('play-wall')
}

describe('PlayOverlay wall autoplay', () => {
  it('a video tile has no player until it comes into view', async () => {
    await mount()
    emit([video('/photos/clip.mp4')])
    expect(tile('clip.mp4').querySelector('video')).toBeNull()
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('a video tile in view mounts a muted looping autoplaying player on the plain stream and starts it', async () => {
    await mount()
    emit([video('/photos/clip.mp4')])
    act(() => setInView(tile('clip.mp4'), true))
    const player = tile('clip.mp4').querySelector('video')
    expect(player).toBeTruthy()
    expect(player.getAttribute('src')).toBe('nas-stream://c1/photos/clip.mp4')
    expect(player.muted).toBe(true)
    expect(player.hasAttribute('loop')).toBe(true)
    expect(player.hasAttribute('autoplay')).toBe(true)
    expect(player.hasAttribute('playsinline')).toBe(true)
    expect(player.hasAttribute('controls')).toBe(false)
    expect(playSpy).toHaveBeenCalled()
  })

  it('a video tile leaving view drops its player', async () => {
    await mount()
    emit([video('/photos/clip.mp4')])
    act(() => setInView(tile('clip.mp4'), true))
    expect(tile('clip.mp4').querySelector('video')).toBeTruthy()
    act(() => setInView(tile('clip.mp4'), false))
    expect(tile('clip.mp4').querySelector('video')).toBeNull()
  })

  it('a video tile coming back into view mounts a fresh player', async () => {
    await mount()
    emit([video('/photos/clip.mp4')])
    act(() => setInView(tile('clip.mp4'), true))
    act(() => setInView(tile('clip.mp4'), false))
    playSpy.mockClear()
    act(() => setInView(tile('clip.mp4'), true))
    expect(tile('clip.mp4').querySelector('video')).toBeTruthy()
    expect(playSpy).toHaveBeenCalled()
  })

  it('only the tiles in view play; the others stay silent', async () => {
    await mount()
    emit([video('/photos/a.mp4'), video('/photos/b.mp4'), video('/photos/c.mp4')])
    act(() => setInView(tile('b.mp4'), true))
    expect(tile('a.mp4').querySelector('video')).toBeNull()
    expect(tile('b.mp4').querySelector('video')).toBeTruthy()
    expect(tile('c.mp4').querySelector('video')).toBeNull()
  })

  it('a playing tile takes the proportions its player reports', async () => {
    await mount()
    emit([video('/photos/clip.mp4')])
    act(() => setInView(tile('clip.mp4'), true))
    const before = tile('clip.mp4').style.height
    const player = tile('clip.mp4').querySelector('video')
    Object.defineProperty(player, 'videoWidth',  { value: 600, configurable: true })
    Object.defineProperty(player, 'videoHeight', { value: 600, configurable: true })
    fireEvent(player, new window.Event('loadedmetadata'))
    const after = tile('clip.mp4').style.height
    expect(after).not.toBe(before)
    expect(after).toBe(tile('clip.mp4').style.width)
  })

  it('remembers a video ratio after its player is dropped', async () => {
    await mount()
    emit([video('/photos/clip.mp4')])
    act(() => setInView(tile('clip.mp4'), true))
    const player = tile('clip.mp4').querySelector('video')
    Object.defineProperty(player, 'videoWidth',  { value: 600, configurable: true })
    Object.defineProperty(player, 'videoHeight', { value: 600, configurable: true })
    fireEvent(player, new window.Event('loadedmetadata'))
    const squareHeight = tile('clip.mp4').style.height
    act(() => setInView(tile('clip.mp4'), false))
    expect(tile('clip.mp4').style.height).toBe(squareHeight)
  })

  it('a gif tile shows the real gif stream, not the static cached thumbnail', async () => {
    await mount()
    emit([image('/photos/anim.gif'), image('/photos/still.jpg')])
    expect(tile('anim.gif').getAttribute('data-type')).toBe('image')
    expect(tile('anim.gif').querySelector('img').getAttribute('src')).toBe('nas-stream://c1/photos/anim.gif')
    expect(tile('still.jpg').querySelector('img').getAttribute('src')).toMatch(/\?thumb=1/)
  })

  it('an upper-case .GIF is treated the same way', async () => {
    await mount()
    emit([image('/photos/LOOP.GIF')])
    expect(tile('LOOP.GIF').querySelector('img').getAttribute('src')).toBe('nas-stream://c1/photos/LOOP.GIF')
  })

  it('opening the viewer drops every wall player and leaves the viewer its own', async () => {
    await mount()
    emit([video('/photos/a.mp4'), video('/photos/b.mp4')])
    act(() => setInView(tile('a.mp4'), true))
    act(() => setInView(tile('b.mp4'), true))
    expect(wall().querySelectorAll('video')).toHaveLength(2)
    fireEvent.click(tile('a.mp4'))
    expect(wall().querySelectorAll('video')).toHaveLength(0)
    const viewerPlayer = screen.getByTestId('play-viewer').querySelector('video')
    expect(viewerPlayer).toBeTruthy()
    expect(viewerPlayer.hasAttribute('controls')).toBe(true)
    expect(viewerPlayer.muted).toBe(false)
  })

  it('returning from the viewer lets tiles in view play again', async () => {
    await mount()
    emit([video('/photos/a.mp4')])
    act(() => setInView(tile('a.mp4'), true))
    fireEvent.click(tile('a.mp4'))
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => setInView(tile('a.mp4'), true))
    expect(tile('a.mp4').querySelector('video')).toBeTruthy()
  })
})
