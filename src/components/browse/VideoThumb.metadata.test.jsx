import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import VideoThumb, { DWELL_MS } from './VideoThumb'
import { __resetDecodeSlots } from '../../utils/decodeSlots'
import { createWinraidMock } from '../../__mocks__/winraid'

// Contract under test — surfacing media metadata (duration / resolution)
// must not regress the behaviour VideoThumb already owns. Two contracts
// matter for the metadata work:
//   • handleLoadedMetadata still seeks to the offset computeSeekTime picks
//     for the given duration + config — the thumbnail should not jump to
//     a different frame because we now also read videoWidth/videoHeight
//     for the row / card / Properties to display.
//   • A thumbnail error still surfaces through onError — the parent needs
//     the signal so a fallback can paint. The metadata path must not
//     swallow, transform, or replace that error.

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

function fireIntersections() {
  for (const obs of intersectionObservers) {
    for (const target of obs.targets) {
      obs.callback(
        [{ isIntersecting: true, intersectionRatio: 1, target, intersectionRect: {}, boundingClientRect: {}, rootBounds: {}, time: 0 }],
        obs,
      )
    }
  }
}

let savedIntersectionObserver

beforeEach(() => {
  vi.useFakeTimers()
  __resetDecodeSlots()
  savedIntersectionObserver = window.IntersectionObserver
  window.IntersectionObserver     = IntersectionObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  intersectionObservers.length = 0

  // Pin thumbSeek to the 2-second default — the metadata work must not
  // change the seek behaviour, so we test against the documented default
  // and the assertion fails if a future change forgets to clamp or picks
  // a different config.
  VideoThumb.__resetSeekConfig()
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({ mode: 'seconds', value: 2 }) },
  })
})

afterEach(() => {
  vi.useRealTimers()
  window.IntersectionObserver     = savedIntersectionObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  VideoThumb.__resetSeekConfig()
  delete window.winraid
})

// The decoder only starts once the card has stayed visible for DWELL_MS.
async function mount(url, props = {}) {
  render(<VideoThumb url={url} onError={props.onError} />)
  await act(async () => { await Promise.resolve() })
  act(() => { fireIntersections() })
  await act(async () => { vi.advanceTimersByTime(DWELL_MS) })
}

function videoEl() {
  const v = document.querySelector('video')
  if (!v) throw new Error('video element not mounted')
  return v
}

describe('VideoThumb — existing behaviour under metadata surfacing', () => {
  it('still seeks to the offset computeSeekTime picks on loadedmetadata', async () => {
    await mount('nas-stream://c1/clip.mp4')

    const v = videoEl()
    Object.defineProperty(v, 'duration', { value: 60, configurable: true })
    fireEvent(v, new window.Event('loadedmetadata'))

    // 2s default config, 60s clip → seekTo = min(2, 60 * 0.9) = 2
    expect(v.currentTime).toBe(2)
  })

  it('still clamps the seek to 90% of duration for short clips', async () => {
    await mount('nas-stream://c1/short.mp4')

    const v = videoEl()
    Object.defineProperty(v, 'duration', { value: 1, configurable: true })
    fireEvent(v, new window.Event('loadedmetadata'))

    // 2s config, 1s clip → seekTo = min(2, 0.9) = 0.9
    expect(v.currentTime).toBeCloseTo(0.9, 5)
  })

  it('still surfaces a load error through onError', async () => {
    const onError = vi.fn()
    await mount('nas-stream://c1/broken.mp4', { onError })

    const v = videoEl()
    fireEvent.error(v)

    expect(onError).toHaveBeenCalledTimes(1)
  })
})
