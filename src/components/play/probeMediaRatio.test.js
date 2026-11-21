import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { probeMediaRatio } from './probeMediaRatio'

// Contract: probeMediaRatio({ src, type, timeoutMs }) resolves the media's
// width / height, read from an image's natural size or a video's metadata,
// without putting anything on screen. It resolves null on a load error, on
// zero dimensions, or when nothing arrives within timeoutMs, and never
// rejects, so one broken file cannot stall the wall.

let createdImages = []
class ImageStub {
  constructor() { createdImages.push(this) }
}

beforeEach(() => {
  createdImages = []
  vi.stubGlobal('Image', ImageStub)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function lastVideo() {
  return [...document.querySelectorAll('video')].at(-1)
}

describe('probeMediaRatio', () => {
  it('reads an image ratio from its natural size', async () => {
    const pending = probeMediaRatio({ src: 'nas-stream://x/a.jpg?thumb=1', type: 'image' })
    const image = createdImages[0]
    expect(image.src).toBe('nas-stream://x/a.jpg?thumb=1')
    image.naturalWidth = 1600
    image.naturalHeight = 1200
    image.onload()
    expect(await pending).toBeCloseTo(4 / 3)
  })

  it('reads a video ratio from its metadata, then lets go of the stream', async () => {
    const created = []
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const element = createElement(tag)
      if (tag === 'video') created.push(element)
      return element
    })
    const pending = probeMediaRatio({ src: 'nas-stream://x/clip.mp4', type: 'video' })
    const video = created[0] ?? lastVideo()
    expect(video.preload).toBe('metadata')
    expect(video.muted).toBe(true)
    Object.defineProperty(video, 'videoWidth',  { value: 1080 })
    Object.defineProperty(video, 'videoHeight', { value: 1920 })
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(await pending).toBeCloseTo(9 / 16)
    expect(video.getAttribute('src')).toBeNull()
  })

  it('resolves null when the file fails to load', async () => {
    const pending = probeMediaRatio({ src: 'nas-stream://x/broken.jpg', type: 'image' })
    createdImages[0].onerror()
    expect(await pending).toBeNull()
  })

  it('resolves null for zero dimensions', async () => {
    const pending = probeMediaRatio({ src: 'nas-stream://x/empty.jpg', type: 'image' })
    createdImages[0].naturalWidth = 0
    createdImages[0].naturalHeight = 0
    createdImages[0].onload()
    expect(await pending).toBeNull()
  })

  it('resolves null when nothing arrives in time', async () => {
    vi.useFakeTimers()
    const pending = probeMediaRatio({ src: 'nas-stream://x/slow.jpg', type: 'image', timeoutMs: 3000 })
    vi.advanceTimersByTime(3000)
    expect(await pending).toBeNull()
  })
})
