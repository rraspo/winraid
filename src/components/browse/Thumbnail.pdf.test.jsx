import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

const openPdf = vi.fn()
vi.mock('../../utils/pdfjsLoader', () => ({ openPdf: (...args) => openPdf(...args) }))

import Thumbnail from './Thumbnail'
import { DWELL_MS } from './PdfThumb'
import { __resetDecodeSlots } from '../../utils/decodeSlots'
import { createWinraidMock } from '../../__mocks__/winraid'
import { findColorLiterals } from '../../test-utils/cssTokens'

// happy-dom has no layout: these cover which element renders and what is
// requested, not how the icon or badge is positioned on screen.

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
  saved = { io: window.IntersectionObserver, create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  window.IntersectionObserver = IntersectionObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  observers.length = 0
  URL.createObjectURL = vi.fn(() => 'blob:page')
  URL.revokeObjectURL = vi.fn()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}))
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    callback(type === 'image/webp' ? new Blob([WEBP], { type: 'image/webp' }) : null)
  }
  __resetDecodeSlots()
  openPdf.mockReset()
  window.winraid = createWinraidMock()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.IntersectionObserver = saved.io
  globalThis.IntersectionObserver = saved.io
  URL.createObjectURL = saved.create
  URL.revokeObjectURL = saved.revoke
  delete window.winraid
})

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const PROPS = { name: 'report.pdf', remotePath: '/docs/report #1.pdf', connectionId: 'c1', modified: 1_760_000_000_000 }

function fakeDocument() {
  const page = {
    getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  }
  return { getPage: vi.fn().mockResolvedValue(page), destroy: vi.fn().mockResolvedValue(undefined) }
}
async function dwell() {
  act(() => setVisible(true))
  await act(async () => { vi.advanceTimersByTime(DWELL_MS) })
  await flush()
}

describe('Thumbnail — PDF icon', () => {
  it.each(['list', 'grid'])('shows the PDF icon with its badge in %s view when thumbnails are off', (size) => {
    const { container, getByText } = render(<Thumbnail {...PROPS} size={size} thumbnailsEnabled={false} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(getByText('PDF')).toBeTruthy()
    expect(openPdf).not.toHaveBeenCalled()
  })

  it('shows the PDF icon in list view and never renders the page', async () => {
    const { getByText } = render(<Thumbnail {...PROPS} size="list" />)
    await dwell()
    expect(getByText('PDF')).toBeTruthy()
    expect(openPdf).not.toHaveBeenCalled()
  })

  it('matches the extension case-insensitively', () => {
    const { getByText } = render(<Thumbnail {...PROPS} name="SCAN.PDF" size="grid" thumbnailsEnabled={false} />)
    expect(getByText('PDF')).toBeTruthy()
  })

  it('keeps colors out of the PDF icon CSS', () => {
    expect(findColorLiterals('src/components/browse/PdfIcon.module.css')).toEqual([])
    expect(findColorLiterals('src/components/browse/PdfThumb.module.css')).toEqual([])
  })
})

describe('Thumbnail — PDF first page in grid', () => {
  it('asks the frame cache first and shows a cached page without opening pdf.js', async () => {
    window.winraid.cache.getVideoFrame.mockResolvedValue({ hit: true, bytes: WEBP, meta: {} })
    const { container } = render(<Thumbnail {...PROPS} size="grid" />)
    await flush()
    await dwell()
    expect(window.winraid.cache.getVideoFrame).toHaveBeenCalledWith('c1', '/docs/report #1.pdf', PROPS.modified)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:page')
    expect(openPdf).not.toHaveBeenCalled()
  })

  it('does nothing before the card has dwelled on screen', async () => {
    render(<Thumbnail {...PROPS} size="grid" />)
    await flush()
    act(() => setVisible(true))
    await act(async () => { vi.advanceTimersByTime(DWELL_MS - 10) })
    await flush()
    expect(openPdf).not.toHaveBeenCalled()
  })

  it('renders page 1 by range from the encoded stream URL, caches it, and shows it', async () => {
    const pdfDocument = fakeDocument()
    const destroyTask = vi.fn()
    openPdf.mockReturnValue({ promise: Promise.resolve(pdfDocument), destroy: destroyTask })
    const { container } = render(<Thumbnail {...PROPS} size="grid" />)
    await flush()
    await dwell()
    await flush()

    const source = openPdf.mock.calls[0][0]
    expect(source.url).toBe('nas-stream://c1/docs/report%20%231.pdf?v=1760000000000')
    expect(source.disableAutoFetch).toBe(true)
    expect(source.disableStream).toBe(true)
    expect(pdfDocument.getPage).toHaveBeenCalledWith(1)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:page')
    expect(window.winraid.cache.saveVideoFrame).toHaveBeenCalledWith('c1', '/docs/report #1.pdf', PROPS.modified, expect.any(Uint8Array), {})
    expect(destroyTask).toHaveBeenCalled()
  })

  it('falls back to a full download when range loading fails', async () => {
    const pdfDocument = fakeDocument()
    openPdf
      .mockReturnValueOnce({ get promise() { return Promise.reject(new Error('range failed')) }, destroy: vi.fn() })
      .mockReturnValueOnce({ promise: Promise.resolve(pdfDocument), destroy: vi.fn() })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }))
    const { container } = render(<Thumbnail {...PROPS} size="grid" />)
    await flush()
    await dwell()
    await flush()
    expect(openPdf.mock.calls[1][0].data).toBeInstanceOf(ArrayBuffer)
    expect(container.querySelector('img')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('falls back to the PDF icon when the document cannot be rendered', async () => {
    openPdf.mockReturnValue({ get promise() { return Promise.reject(new Error('bad')) }, destroy: vi.fn() })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const { container, getByText } = render(<Thumbnail {...PROPS} size="grid" />)
    await flush()
    await dwell()
    await flush()
    expect(container.querySelector('img')).toBeNull()
    expect(getByText('PDF')).toBeTruthy()
    expect(window.winraid.cache.saveVideoFrame).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('never renders when thumbnails are disabled', async () => {
    render(<Thumbnail {...PROPS} size="grid" thumbnailsEnabled={false} />)
    await dwell()
    expect(openPdf).not.toHaveBeenCalled()
    expect(window.winraid.cache.getVideoFrame).not.toHaveBeenCalled()
  })
})
