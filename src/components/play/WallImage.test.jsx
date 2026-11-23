import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import WallImage, { FULL_IMAGE_DWELL_MS } from './WallImage'

// Contract under test: a still-image wall tile shows its cached thumbnail at
// once and, while the tile stays on screen, layers the full-resolution image
// over it, swapping in only once it has loaded. Off screen, or while the
// viewer covers the wall, only the thumbnail remains.

const observers = []
class IntersectionObserverStub {
  constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this) }
  observe(element)   { this.targets.add(element) }
  unobserve(element) { this.targets.delete(element) }
  disconnect()       { this.targets.clear() }
  takeRecords()      { return [] }
}

function setInView(isIntersecting) {
  for (const observer of observers) {
    for (const target of observer.targets) {
      observer.callback([{ isIntersecting, target }], observer)
    }
  }
}

let savedObserver
beforeEach(() => {
  vi.useFakeTimers()
  savedObserver = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = IntersectionObserverStub
  observers.length = 0
})
afterEach(() => {
  vi.useRealTimers()
  globalThis.IntersectionObserver = savedObserver
})

const THUMB = 'nas-stream://c1/photos/a.jpg?thumb=1'
const FULL  = 'nas-stream://c1/photos/a.jpg'

function mount(props = {}) {
  return render(<WallImage thumbSrc={THUMB} fullSrc={FULL} onThumbLoad={vi.fn()} {...props} />)
}

function images(container) {
  return [...container.querySelectorAll('img')]
}

function fullImage(container) {
  return container.querySelector('img[data-full]')
}

describe('WallImage', () => {
  it('shows only the thumbnail while off screen', () => {
    const { container } = mount()
    expect(images(container).map((image) => image.getAttribute('src'))).toEqual([THUMB])
  })

  it('loads the full image after the tile has stayed on screen briefly', () => {
    const { container } = mount()
    act(() => setInView(true))
    expect(fullImage(container)).toBeNull()
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS) })
    expect(fullImage(container).getAttribute('src')).toBe(FULL)
  })

  it('keeps the full image hidden until it has loaded, then shows it', () => {
    const { container } = mount()
    act(() => setInView(true))
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS) })
    expect(fullImage(container).getAttribute('data-loaded')).toBe('false')
    fireEvent.load(fullImage(container))
    expect(fullImage(container).getAttribute('data-loaded')).toBe('true')
  })

  it('never requests the full image for a tile scrolled straight past', () => {
    const { container } = mount()
    act(() => setInView(true))
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS - 1) })
    act(() => setInView(false))
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS) })
    expect(fullImage(container)).toBeNull()
  })

  it('drops the full image when the tile leaves the screen', () => {
    const { container } = mount()
    act(() => setInView(true))
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS) })
    fireEvent.load(fullImage(container))
    act(() => setInView(false))
    expect(fullImage(container)).toBeNull()
    expect(images(container).map((image) => image.getAttribute('src'))).toEqual([THUMB])
  })

  it('does not load the full image while the viewer covers the wall', () => {
    const { container, rerender } = mount({ suspended: true })
    act(() => setInView(true))
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS) })
    expect(fullImage(container)).toBeNull()
    rerender(<WallImage thumbSrc={THUMB} fullSrc={FULL} onThumbLoad={vi.fn()} suspended={false} />)
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS) })
    expect(fullImage(container).getAttribute('src')).toBe(FULL)
  })

  it('keeps the thumbnail when the full image fails to load', () => {
    const { container } = mount()
    act(() => setInView(true))
    act(() => { vi.advanceTimersByTime(FULL_IMAGE_DWELL_MS) })
    fireEvent.error(fullImage(container))
    expect(fullImage(container)).toBeNull()
    expect(images(container).map((image) => image.getAttribute('src'))).toEqual([THUMB])
  })

  it('reports the thumbnail load so the wall learns the shape', () => {
    const onThumbLoad = vi.fn()
    const { container } = mount({ onThumbLoad })
    fireEvent.load(images(container)[0])
    expect(onThumbLoad).toHaveBeenCalledTimes(1)
  })
})
