import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import PlayWall from './PlayWall'
import { probeMediaRatio } from './probeMediaRatio'

// Contract: once the wall knows its width it lays tiles out in justified
// rows, and a tile joins the wall only when its shape is known (and every
// tile before it is placed), so rows never jump as files load. Shapes come
// from probeMediaRatio; a file it cannot read falls back to 16:9 for a video
// and 1:1 for an image. No new page is requested while shapes are pending.

vi.mock('./probeMediaRatio', () => ({ probeMediaRatio: vi.fn() }))

const WALL_WIDTH = 1000

const intersectionObservers = []
class IntersectionObserverStub {
  constructor(callback) { this.callback = callback; this.targets = new Set(); intersectionObservers.push(this) }
  observe(element) { this.targets.add(element) }
  unobserve(element) { this.targets.delete(element) }
  disconnect() { this.targets.clear() }
  takeRecords() { return [] }
}
function intersect(element) {
  for (const observer of intersectionObservers) {
    if (observer.targets.has(element)) observer.callback([{ isIntersecting: true, target: element }], observer)
  }
}
class ResizeObserverStub {
  constructor(callback) { this.callback = callback }
  observe(element) { this.callback([{ target: element, contentRect: { width: WALL_WIDTH } }]) }
  unobserve() {}
  disconnect() {}
}

let pendingProbes
let savedConfig
beforeEach(() => {
  savedConfig = {}
  window.winraid = {
    config: {
      get: vi.fn((key) => Promise.resolve(savedConfig[key])),
      set: vi.fn((key, value) => { savedConfig[key] = value; return Promise.resolve({}) }),
    },
  }
  intersectionObservers.length = 0
  pendingProbes = new Map()
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  probeMediaRatio.mockReset()
  probeMediaRatio.mockImplementation(({ src }) => new Promise((resolve) => pendingProbes.set(src, resolve)))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.winraid
})

function image(path) { return { path, size: 100, mtime: 0, type: 'image' } }
function video(path) { return { path, size: 5000, mtime: 0, type: 'video' } }

async function resolveProbe(fragment, ratio) {
  const src = [...pendingProbes.keys()].find((key) => key.includes(fragment))
  expect(src, `a probe for ${fragment}`).toBeDefined()
  await act(async () => { pendingProbes.get(src)(ratio) })
}

function renderWall(playlist, props = {}) {
  const fill = vi.fn()
  render(
    <PlayWall
      connectionId="c1" scanRoot="/media" playlist={playlist} scanning={false} poolSize={10}
      recursive shuffle={false} toggleRecursive={vi.fn()} toggleShuffle={vi.fn()}
      error={null} retry={vi.fn()} pageSize={24} fill={fill}
      onSegmentClick={vi.fn()} onOpenTile={vi.fn()} onToggleFullscreen={vi.fn()} onClose={vi.fn()}
      hiddenFromViewer={false} fileVersions={new Map()}
      selectedPaths={new Set()} onToggleSelect={vi.fn()} onSelectRange={vi.fn()} onClearSelection={vi.fn()}
      onRequestBulkDelete={vi.fn()} onRequestBulkMove={vi.fn()} mutationInFlight={false}
      {...props}
    />,
  )
  return { fill }
}

function tileBox(name) {
  const tile = screen.queryByRole('button', { name: `Open ${name}` })
  if (!tile) return null
  const { left, top, width, height } = tile.parentElement.style
  return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) }
}

describe('PlayWall justified rows', () => {
  it('places a tile only once its shape is known, and holds the tiles after it', async () => {
    renderWall([image('/media/a.jpg'), video('/media/b.mp4')])
    expect(tileBox('a.jpg')).toBeNull()
    expect(tileBox('b.mp4')).toBeNull()

    await resolveProbe('b.mp4', 16 / 9)
    expect(tileBox('b.mp4')).toBeNull()

    await resolveProbe('a.jpg', 9 / 16)
    expect(tileBox('a.jpg')).not.toBeNull()
    expect(tileBox('b.mp4')).not.toBeNull()
  })

  it('gives every tile in a row one height and a width that follows its shape', async () => {
    renderWall([video('/media/wide.mp4'), image('/media/reel.jpg')])
    await resolveProbe('wide.mp4', 16 / 9)
    await resolveProbe('reel.jpg', 9 / 16)
    const wide = tileBox('wide.mp4')
    const reel = tileBox('reel.jpg')
    expect(wide.top).toBe(reel.top)
    expect(wide.height).toBe(reel.height)
    expect(wide.width / reel.width).toBeCloseTo((16 / 9) / (9 / 16), 0)
    expect(wide.width).toBeGreaterThan(400)
  })

  it('falls back to a default shape when a file cannot be read', async () => {
    renderWall([video('/media/broken.mp4'), image('/media/broken.jpg')])
    await resolveProbe('broken.mp4', null)
    await resolveProbe('broken.jpg', null)
    const brokenVideo = tileBox('broken.mp4')
    const brokenImage = tileBox('broken.jpg')
    expect(brokenVideo.width / brokenVideo.height).toBeCloseTo(16 / 9, 1)
    expect(brokenImage.width / brokenImage.height).toBeCloseTo(1, 1)
  })

  it('probes the same thumbnail URL the image tile shows', async () => {
    renderWall([image('/media/a.jpg')])
    const [{ src, type }] = probeMediaRatio.mock.calls[0]
    expect(type).toBe('image')
    expect(src).toContain('thumb=1')
    await resolveProbe('a.jpg', 4 / 3)
    expect(screen.getByRole('button', { name: 'Open a.jpg' }).querySelector('img').getAttribute('src')).toBe(src)
  })

  it('requests the next page only after the pending shapes are known', async () => {
    const { fill } = renderWall([image('/media/a.jpg')])
    intersect(screen.getByTestId('play-wall-sentinel'))
    expect(fill).not.toHaveBeenCalled()
    await resolveProbe('a.jpg', 1)
    intersect(screen.getByTestId('play-wall-sentinel'))
    expect(fill).toHaveBeenCalledWith(24)
  })
})

describe('PlayWall tile size', () => {
  function slider() {
    return screen.getByRole('slider', { name: 'Tile size' })
  }

  it('opens at a 360px row height', async () => {
    renderWall([image('/media/a.jpg')])
    await resolveProbe('a.jpg', 1)
    expect(slider().value).toBe('360')
    expect(tileBox('a.jpg').height).toBe(360)
  })

  it('resizes the rows as the slider moves', async () => {
    renderWall([image('/media/a.jpg')])
    await resolveProbe('a.jpg', 1)
    fireEvent.change(slider(), { target: { value: '520' } })
    expect(tileBox('a.jpg').height).toBe(520)
    expect(tileBox('a.jpg').width).toBe(520)
  })

  it('restores the saved size', async () => {
    savedConfig.playWall = { rowHeight: 220 }
    renderWall([image('/media/a.jpg')])
    await resolveProbe('a.jpg', 1)
    await waitFor(() => expect(slider().value).toBe('220'))
    expect(tileBox('a.jpg').height).toBe(220)
  })

  it('saves the size once the slider settles', async () => {
    renderWall([image('/media/a.jpg')])
    await resolveProbe('a.jpg', 1)
    fireEvent.change(slider(), { target: { value: '400' } })
    fireEvent.change(slider(), { target: { value: '440' } })
    await waitFor(() => expect(window.winraid.config.set).toHaveBeenCalledWith('playWall', { rowHeight: 440 }))
    expect(window.winraid.config.set).toHaveBeenCalledTimes(1)
  })
})
