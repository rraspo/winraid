import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PlayOverlay from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the Play wall on the redesign, after
// ref/play-wall.png: a page header with the title, a subtitle carrying the
// file count and the scan-root breadcrumbs, and the four labeled controls
// at the right; tiles carry a video badge, a GIF badge, and a playing
// indicator. Every behavior from PlayOverlay.test.jsx, the autoplay suite
// and the selection suite stays: the controls keep their accessible names,
// the breadcrumbs keep rescoping, the wall keeps paging and selecting.
//
// DOM contract:
//   - <h1>Play wall</h1>
//   - a subtitle containing "<n> files" (walked plus pooled) followed by
//     the scan-root breadcrumbs (segment buttons, scan root aria-current)
//   - controls in this order with visible text and unchanged accessible
//     names: "Shuffle" (aria-label "Toggle shuffle", aria-pressed),
//     "Recursive" (aria-label "Toggle recursive scan", aria-pressed),
//     "Fullscreen" (aria-label "Toggle fullscreen"), "Back to browser"
//     (aria-label "Close")
//   - a video tile contains an element with data-badge="video"; a gif tile
//     contains an element with data-badge="gif" reading "GIF"; a tile
//     whose wall player is running carries data-playing="true"

vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

let onMediaFoundCb = null

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
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
  window.IntersectionObserver     = IntersectionObserverStub
  window.ResizeObserver           = ResizeObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  globalThis.ResizeObserver       = ResizeObserverStub
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
  delete window.winraid
})

const props = {
  connectionId: 'c1', path: '/photos', onClose: vi.fn(), remoteBasePath: '/photos',
  canServerEdit: true, onMutated: vi.fn(), sftpCfg: null,
}

function image(path) { return { path, size: 100, mtime: 0, type: 'image' } }
function video(path) { return { path, size: 5000, mtime: 0, type: 'video' } }

async function mount(files) {
  render(<PlayOverlay {...props} />)
  await act(async () => {})
  act(() => { onMediaFoundCb?.({ files }) })
}

function tile(name) {
  return screen.getByRole('button', { name: `Open ${name}`, hidden: true })
}

describe('PlayOverlay redesign', () => {
  it('has the title, the file count and the breadcrumbs in the subtitle', async () => {
    await mount([image('/photos/a.jpg'), image('/photos/b.jpg'), image('/photos/c.jpg')])
    expect(screen.getByRole('heading', { level: 1, name: 'Play wall' })).toBeInTheDocument()
    expect(screen.getByText(/3 files/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'photos' }).getAttribute('aria-current')).toBe('true')
  })

  it('labels the controls visibly while keeping their accessible names', async () => {
    await mount([image('/photos/a.jpg')])
    const shuffle    = screen.getByRole('button', { name: 'Toggle shuffle' })
    const recursive  = screen.getByRole('button', { name: 'Toggle recursive scan' })
    const fullscreen = screen.getByRole('button', { name: 'Toggle fullscreen' })
    const back       = screen.getByRole('button', { name: 'Close' })
    expect(shuffle.textContent).toContain('Shuffle')
    expect(recursive.textContent).toContain('Recursive')
    expect(fullscreen.textContent).toContain('Fullscreen')
    expect(back.textContent).toContain('Back to browser')
    const order = [shuffle, recursive, fullscreen, back].map((button) => button.compareDocumentPosition(back))
    expect(order.slice(0, 3).every((position) => position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('badges video and gif tiles', async () => {
    await mount([video('/photos/clip.mp4'), image('/photos/loop.gif'), image('/photos/still.jpg')])
    expect(tile('clip.mp4').querySelector('[data-badge="video"]')).toBeTruthy()
    const gifBadge = tile('loop.gif').querySelector('[data-badge="gif"]')
    expect(gifBadge).toBeTruthy()
    expect(gifBadge.textContent).toBe('GIF')
    expect(tile('still.jpg').querySelector('[data-badge]')).toBeNull()
  })
})
