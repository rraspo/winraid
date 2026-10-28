import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import VideoThumb, { DWELL_MS } from './VideoThumb'
import { MAX_DECODERS, __resetDecodeSlots } from '../../utils/decodeSlots'
import { createWinraidMock } from '../../__mocks__/winraid'

// Contract under test — a video thumbnail costs nothing until it is worth
// it. The card shows its cheap placeholder first; a still already captured
// for this file is shown as an image and no decoder is ever started; on a
// miss, a <video> is only created once the card has stayed on screen for
// DWELL_MS, at most MAX_DECODERS at a time, and it is removed again as soon
// as its frame has been captured and handed to the cache as WebP.

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4])

const observers = []
class IntersectionObserverStub {
  constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this) }
  observe(el) { this.targets.add(el) }
  unobserve(el) { this.targets.delete(el) }
  disconnect() { this.targets.clear() }
  takeRecords() { return [] }
}

function setVisible(isIntersecting) {
  for (const observer of observers) {
    for (const target of observer.targets) observer.callback([{ isIntersecting, target }], observer)
  }
}

let saved
beforeEach(() => {
  vi.useFakeTimers()
  saved = { io: window.IntersectionObserver, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
  window.IntersectionObserver = IntersectionObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  observers.length = 0
  URL.createObjectURL = vi.fn(() => 'blob:still')
  URL.revokeObjectURL = vi.fn()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }))
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    callback(type === 'image/webp' ? new Blob([WEBP], { type: 'image/webp' }) : null)
  }
  VideoThumb.__resetSeekConfig()
  __resetDecodeSlots()
  window.winraid = createWinraidMock({ config: { get: vi.fn().mockResolvedValue(null) } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.IntersectionObserver = saved.io
  globalThis.IntersectionObserver = saved.io
  URL.createObjectURL = saved.createObjectURL
  URL.revokeObjectURL = saved.revokeObjectURL
  delete window.winraid
})

const PROPS = {
  url: 'nas-stream://c1/media/clip.mp4?thumb=1&v=1760000000000',
  connectionId: 'c1',
  remotePath: '/media/clip.mp4',
  modified: 1_760_000_000_000,
  placeholder: <span data-testid="placeholder" />,
}

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

async function mount(props = {}) {
  const utils = render(<VideoThumb {...PROPS} {...props} />)
  await flush()
  return utils
}

async function dwell() {
  act(() => setVisible(true))
  await act(async () => { vi.advanceTimersByTime(DWELL_MS) })
  await flush()
}

async function captureFrame(video = document.querySelector('video')) {
  Object.defineProperty(video, 'duration', { configurable: true, value: 60 })
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 })
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 })
  fireEvent.loadedMetadata(video)
  fireEvent.seeked(video)
  // Capture is a chain of promises (bitmap, encode, bytes, save); let it run out.
  for (let i = 0; i < 5; i++) await flush()
}

describe('VideoThumb — cheap first, decode only when worth it', () => {
  it('shows the placeholder, not an animated skeleton, while nothing is known yet', async () => {
    const { getByTestId, container } = await mount()
    expect(getByTestId('placeholder')).toBeTruthy()
    expect(container.querySelector('[data-skeleton]')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })

  it('shows a cached still as an image and never starts a decoder', async () => {
    const onMetadata = vi.fn()
    window.winraid.cache.getVideoFrame.mockResolvedValue({ hit: true, bytes: WEBP, meta: { duration: 60, width: 1920, height: 1080 } })
    const { container } = await mount({ onMetadata })
    await dwell()

    expect(window.winraid.cache.getVideoFrame).toHaveBeenCalledWith('c1', '/media/clip.mp4', PROPS.modified)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:still')
    expect(container.querySelector('video')).toBeNull()
    expect(onMetadata).toHaveBeenCalledWith({ duration: 60, width: 1920, height: 1080 })
  })

  it('starts no decoder for a card scrolled past before the dwell ends', async () => {
    const { container } = await mount()
    act(() => setVisible(true))
    await act(async () => { vi.advanceTimersByTime(DWELL_MS - 50) })
    act(() => setVisible(false))
    await act(async () => { vi.advanceTimersByTime(DWELL_MS * 4) })
    expect(container.querySelector('video')).toBeNull()
  })

  it('starts a decoder once the card has stayed visible for the dwell', async () => {
    const { container } = await mount()
    await dwell()
    expect(container.querySelector('video')).not.toBeNull()
  })

  it('captures the frame as WebP, caches it with the media facts, and removes the decoder', async () => {
    const onMetadata = vi.fn()
    const { container } = await mount({ onMetadata })
    await dwell()
    await captureFrame()

    expect(window.winraid.cache.saveVideoFrame).toHaveBeenCalledWith(
      'c1', '/media/clip.mp4', PROPS.modified, expect.any(Uint8Array), { duration: 60, width: 1920, height: 1080 },
    )
    const [, , , bytes] = window.winraid.cache.saveVideoFrame.mock.calls[0]
    expect(Array.from(bytes.subarray(8, 12))).toEqual([0x57, 0x45, 0x42, 0x50])
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:still')
    expect(onMetadata).toHaveBeenCalledWith({ duration: 60, width: 1920, height: 1080 })
  })

  it('scales the frame down off the main thread before drawing it, never drawing the full-size video', async () => {
    const bitmap = { width: 320, height: 180, close: vi.fn() }
    const drawImage = vi.fn()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage }))
    const createImageBitmap = vi.fn().mockResolvedValue(bitmap)
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    await mount()
    await dwell()
    const video = document.querySelector('video')
    await captureFrame(video)

    expect(createImageBitmap).toHaveBeenCalledWith(video, expect.objectContaining({ resizeWidth: 320, resizeHeight: 180 }))
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(drawImage).not.toHaveBeenCalledWith(video, expect.anything(), expect.anything(), expect.anything(), expect.anything())
    expect(bitmap.close).toHaveBeenCalled()
    expect(window.winraid.cache.saveVideoFrame).toHaveBeenCalled()
  })

  it('still captures, the slower way, when the frame cannot be turned into a bitmap', async () => {
    const drawImage = vi.fn()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage }))
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported source')))
    await mount()
    await dwell()
    const video = document.querySelector('video')
    await captureFrame(video)

    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180)
    expect(window.winraid.cache.saveVideoFrame).toHaveBeenCalled()
  })

  it(`runs at most ${MAX_DECODERS} decoders at once, and the next starts when one finishes`, async () => {
    render(
      <div>
        {Array.from({ length: MAX_DECODERS + 2 }, (_, i) => (
          <VideoThumb key={i} {...PROPS} remotePath={`/media/clip-${i}.mp4`} url={`nas-stream://c1/media/clip-${i}.mp4?thumb=1`} />
        ))}
      </div>,
    )
    await flush()
    await dwell()
    expect(document.querySelectorAll('video')).toHaveLength(MAX_DECODERS)

    await captureFrame(document.querySelectorAll('video')[0])
    expect(document.querySelectorAll('video')).toHaveLength(MAX_DECODERS)
    expect(window.winraid.cache.saveVideoFrame).toHaveBeenCalledTimes(1)
  })

  it('frees its decoder slot when unmounted mid-decode', async () => {
    const first = await mount()
    await dwell()
    expect(document.querySelectorAll('video')).toHaveLength(1)
    first.unmount()

    render(
      <div>
        {Array.from({ length: MAX_DECODERS }, (_, i) => (
          <VideoThumb key={i} {...PROPS} remotePath={`/media/next-${i}.mp4`} url={`nas-stream://c1/media/next-${i}.mp4?thumb=1`} />
        ))}
      </div>,
    )
    await flush()
    await dwell()
    expect(document.querySelectorAll('video')).toHaveLength(MAX_DECODERS)
  })

  it('keeps a frame already being captured when the stream errors afterwards', async () => {
    const onError = vi.fn()
    const { container } = await mount({ onError })
    await dwell()
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 60 })
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 })
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 })
    fireEvent.loadedMetadata(video)
    fireEvent.seeked(video)
    fireEvent.error(video)
    await flush()
    await flush()

    expect(onError).not.toHaveBeenCalled()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:still')
    expect(window.winraid.cache.saveVideoFrame).toHaveBeenCalled()
  })

  it('reports a decode error and frees the slot', async () => {
    const onError = vi.fn()
    await mount({ onError })
    await dwell()
    fireEvent.error(document.querySelector('video'))
    await flush()
    expect(onError).toHaveBeenCalled()
    expect(document.querySelector('video')).toBeNull()
  })
})
