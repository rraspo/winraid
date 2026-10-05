import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — Browse already measures media metadata when it
// paints a thumbnail (video.duration + video.videoWidth/videoHeight for a
// video, img.naturalWidth/naturalHeight for an image). Today it throws that
// metadata away. This suite pins where it must surface instead:
//
//   • Grid card: a bar across the bottom of the thumbnail with duration on
//     the left and resolution on the right (duration before resolution in
//     DOM order). Images show whatever makes sense — no duration.
//   • List row: a single Media column carrying `12:04 · 4K` for video,
//     `6000 × 4000` for images, blank for anything else.
//   • Media column is present iff thumbnails are enabled. The metadata is
//     only known once a thumbnail has rendered, so a permanently empty
//     column would be noise; hide it instead.
//   • Properties: Duration and Resolution join the Size-and-time section
//     for a video; Dimensions joins it for an image. No new IPC — the
//     thumbnail is the source, so surfacing the metadata costs nothing
//     extra.
//
// The mechanism by which the value travels from the thumbnail component
// up to the row / card / Properties is the implementer's choice; these
// tests assert only what renders.

// ── Test harness ──────────────────────────────────────────────────────────

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]
const CONN_ID = 'conn-1'

const VIDEO_ENTRY = { name: 'clip.mp4',  type: 'file', size: 50_000_000, modified: Date.now() }
const IMAGE_ENTRY = { name: 'photo.jpg', type: 'file', size: 4_200_000,  modified: Date.now() }
const TEXT_ENTRY  = { name: 'notes.txt', type: 'file', size: 1024,       modified: Date.now() }
const DIR_ENTRY   = { name: 'Documents', type: 'dir',  size: 0,          modified: Date.now() }

// happy-dom ships an IntersectionObserver but never auto-fires it, and
// VideoThumb gates mounting the <video> element on its callback. This
// stub records every observed target and exposes a way to mark them all
// intersecting — the only behaviour VideoThumb actually relies on.
const intersectionObservers = []
class IntersectionObserverStub {
  constructor(callback, options) {
    this.callback = callback
    this.options  = options
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

// Install / restore the stub around every test so VideoThumb's
// IntersectionObserver-based lazy mount doesn't strand. Also seed the
// window.winraid mock and the storage / layout stubs the existing suite
// already relies on, so per-test setup is one call away.
let savedIntersectionObserver
let savedOffsetHeight
let savedScrollHeight
let savedGetItem
let savedSetItem
let activeEntries = []
let activeConnOverrides = {}
let storageGetItemReturn = 'list'

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  window.IntersectionObserver     = IntersectionObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  intersectionObservers.length = 0

  savedOffsetHeight  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  savedScrollHeight  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight',  { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 800 })

  // Replace Storage.prototype.getItem outright instead of spying — spies
  // created with vi.spyOn get restored by vi.restoreAllMocks(), and a
  // re-spying on the same method in a later test is a fragile pattern that
  // has been observed to leak the previous test's return value across
  // tests in this environment.
  savedGetItem = Storage.prototype.getItem
  savedSetItem = Storage.prototype.setItem
  Storage.prototype.getItem = function (key) {
    if (key === 'browse-view') return storageGetItemReturn
    return null
  }
  Storage.prototype.setItem = function () { /* no-op */ }

  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections')        return Promise.resolve([{ ...CONNECTIONS[0], ...activeConnOverrides }])
        if (key === 'activeConnectionId') return Promise.resolve(CONN_ID)
        return Promise.resolve({ connections: [{ ...CONNECTIONS[0], ...activeConnOverrides }], activeConnectionId: CONN_ID })
      }),
    },
    remote: { list: vi.fn().mockResolvedValue({ ok: true, entries: activeEntries }) },
  })
})

afterEach(() => {
  cleanup()
  window.IntersectionObserver     = savedIntersectionObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  if (savedOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight',  savedOffsetHeight)
  if (savedScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', savedScrollHeight)
  if (savedGetItem) Storage.prototype.getItem = savedGetItem
  if (savedSetItem) Storage.prototype.setItem = savedSetItem
  remoteFS.clearAll()
  toast.clearAll()
  delete window.winraid
  vi.restoreAllMocks()
  activeEntries = []
  activeConnOverrides = {}
  storageGetItemReturn = 'list'
})

// Set the read-only media metadata properties happy-dom ignores assignment
// for, then dispatch the events React listens for. The values are chosen
// to be unambiguous: 724 s = 12:04, 3840×2160 = the canonical "4K" bucket.
function driveVideoMetadata(video, { duration = 724, videoWidth = 3840, videoHeight = 2160 } = {}) {
  Object.defineProperty(video, 'duration',   { value: duration,   configurable: true })
  Object.defineProperty(video, 'videoWidth',  { value: videoWidth,  configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: videoHeight, configurable: true })
  fireEvent(video, new window.Event('loadedmetadata'))
  fireEvent(video, new window.Event('loadeddata'))
}

function driveImageMetadata(img, { naturalWidth = 6000, naturalHeight = 4000 } = {}) {
  Object.defineProperty(img, 'naturalWidth',  { value: naturalWidth,  configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: naturalHeight, configurable: true })
  fireEvent(img, new window.Event('load'))
}

// Mount BrowseView in the requested view mode and return once a known
// entry name is on screen — the cheapest "the view has rendered" signal.
async function mountView(entries, { view = 'list', connOverrides = {} } = {}) {
  activeEntries = entries
  activeConnOverrides = connOverrides
  // Re-seed the winraid mock for this entry set; the mock is built once in
  // beforeEach and its list fn would otherwise resolve the previous test's
  // entries here.
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections')        return Promise.resolve([{ ...CONNECTIONS[0], ...connOverrides }])
        if (key === 'activeConnectionId') return Promise.resolve(CONN_ID)
        return Promise.resolve({ connections: [{ ...CONNECTIONS[0], ...connOverrides }], activeConnectionId: CONN_ID })
      }),
    },
    remote: { list: vi.fn().mockResolvedValue({ ok: true, entries }) },
  })
  // The beforeEach-installed getItem replacement reads storageGetItemReturn
  // on every call. Set it here so the initial useState(() => localStorage
  // .getItem('browse-view') ?? 'list') picks up this test's view mode.
  storageGetItemReturn = view
  render(<BrowseView onHistoryPush={() => {}} connectionId={CONN_ID} />)
  await screen.findByText(entries[0].name)
}

function row(name) {
  const matches = screen.getAllByText(name)
  const inRow = matches.find((el) => el.closest('.row'))
  return inRow?.closest('.row')
}

function card(name) {
  const matches = screen.getAllByText(name)
  const inCard = matches.find((el) => el.closest('.gridCard'))
  return inCard?.closest('.gridCard')
}

// Fire all observers, then yield so React can commit. The `<video>`
// element only mounts after the observer callback fires; this is what
// brings it into the DOM so we can drive its metadata. Observers are
// re-fired on every attempt: on a loaded runner a row can start observing
// after a single early fire, and its thumbnail would then never mount.
async function mountThumbnailsFor(names) {
  const missingThumbnail = () => names.find((name) => {
    const r = row(name) || card(name)
    return !(r && r.querySelector('video, img'))
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { fireIntersections() })
    if (!missingThumbnail()) break
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  await waitFor(() => {
    const missing = missingThumbnail()
    if (missing) throw new Error(`thumbnail not yet mounted for ${missing}`)
  })
}

// ── Case 1: Grid video bar ────────────────────────────────────────────────

describe('BrowseView — grid card surfaces video metadata as a bar', () => {
  it('video card renders a bar with duration and resolution, duration before resolution in DOM order', async () => {
    await mountView([VIDEO_ENTRY], { view: 'grid' })
    await mountThumbnailsFor([VIDEO_ENTRY.name])

    const videos = document.querySelectorAll('video')
    expect(videos.length).toBeGreaterThan(0)
    driveVideoMetadata(videos[0])

    await waitFor(() => {
      const c = card(VIDEO_ENTRY.name)
      expect(c).toBeTruthy()
      expect(c.textContent).toMatch(/12:04/)
      expect(c.textContent).toMatch(/4K/)
    })

    const c = card(VIDEO_ENTRY.name)
    const text = c.textContent
    expect(text.indexOf('12:04')).toBeGreaterThan(-1)
    expect(text.indexOf('4K')).toBeGreaterThan(-1)
    expect(text.indexOf('12:04')).toBeLessThan(text.indexOf('4K'))
  })
})

// ── Case 2: Grid image — no duration ──────────────────────────────────────

describe('BrowseView — grid card for an image has no duration', () => {
  it('does not render a duration-shaped string on an image card', async () => {
    await mountView([IMAGE_ENTRY], { view: 'grid' })
    await mountThumbnailsFor([IMAGE_ENTRY.name])

    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBeGreaterThan(0)
    driveImageMetadata(imgs[0])

    await waitFor(() => {
      const c = card(IMAGE_ENTRY.name)
      expect(c).toBeTruthy()
    })

    const c = card(IMAGE_ENTRY.name)
    // An image has no duration; the grid must not invent one. A bare
    // "12:34"-style token on the card is the failure we're guarding
    // against — the grid for an image is either silent or carries the
    // dimensions, not a duration.
    expect(c.textContent).not.toMatch(/\b\d{1,2}:\d{2}\b/)
  })
})

// ── Case 3 & 4: List — Media column shape for video / image ───────────────

describe('BrowseView — list Media column', () => {
  it('renders `12:04 · 4K` for a video row', async () => {
    await mountView([VIDEO_ENTRY])
    await mountThumbnailsFor([VIDEO_ENTRY.name])

    const videos = document.querySelectorAll('video')
    expect(videos.length).toBeGreaterThan(0)
    driveVideoMetadata(videos[0])

    await waitFor(() => {
      const r = row(VIDEO_ENTRY.name)
      expect(r.textContent).toMatch(/12:04\s*·\s*4K/)
    })
  })

  it('renders pixel dimensions for an image row', async () => {
    await mountView([IMAGE_ENTRY])
    await mountThumbnailsFor([IMAGE_ENTRY.name])

    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBeGreaterThan(0)
    driveImageMetadata(imgs[0])

    await waitFor(() => {
      const r = row(IMAGE_ENTRY.name)
      expect(r.textContent).toMatch(/6000\s*×\s*4000/)
    })
  })
})

// ── Case 5: List row that is neither video nor image ──────────────────────

describe('BrowseView — list Media column for non-media rows', () => {
  it('a text row carries no Media-column content', async () => {
    await mountView([TEXT_ENTRY])

    await waitFor(() => {
      const r = row(TEXT_ENTRY.name)
      expect(r).toBeTruthy()
    })

    const r = row(TEXT_ENTRY.name)
    expect(r.textContent).not.toMatch(/\b\d{1,2}:\d{2}\b/)
    expect(r.textContent).not.toMatch(/\d+\s*×\s*\d+/)
  })

  it('a folder row carries no Media-column content', async () => {
    await mountView([DIR_ENTRY])

    await waitFor(() => {
      const r = row(DIR_ENTRY.name)
      expect(r).toBeTruthy()
    })

    const r = row(DIR_ENTRY.name)
    expect(r.textContent).not.toMatch(/\b\d{1,2}:\d{2}\b/)
    expect(r.textContent).not.toMatch(/\d+\s*×\s*\d+/)
  })
})

// ── Case 6: Media column presence is gated by thumbnails-enabled ──────────

describe('BrowseView — Media column gated by thumbnails preference', () => {
  it('is present when thumbnails are enabled (default)', async () => {
    await mountView([VIDEO_ENTRY])
    await mountThumbnailsFor([VIDEO_ENTRY.name])

    const videos = document.querySelectorAll('video')
    driveVideoMetadata(videos[0])

    await waitFor(() => {
      const r = row(VIDEO_ENTRY.name)
      expect(r.textContent).toMatch(/12:04\s*·\s*4K/)
    })

    // The list view renders a sticky column header row above the entries.
    const header = document.querySelector('.colHeader')
    expect(header).toBeTruthy()
    expect(header.textContent).toMatch(/Media/)
  })

  it('is absent when thumbnails are disabled', async () => {
    await mountView([VIDEO_ENTRY, IMAGE_ENTRY], {
      connOverrides: { browseOptions: { thumbnails: false, columns: { size: true, modified: true, kind: true } } },
    })

    // With thumbnails disabled, neither video nor image get a <video>/<img>
    // — both Thumbnail.jsx branches bail on thumbnailsEnabled=false.
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('.row img, .gridCard img')).toBeNull()

    // Drive the metadata anyway — surfacing it would be a bug. No row may
    // contain a duration/dimension token.
    const allRows = document.querySelectorAll('.row')
    for (const r of allRows) {
      expect(r.textContent).not.toMatch(/\b\d{1,2}:\d{2}\b/)
      expect(r.textContent).not.toMatch(/\d+\s*×\s*\d+/)
    }

    // The header row also must not advertise the Media column.
    const header = document.querySelector('.colHeader')
    if (header) expect(header.textContent).not.toMatch(/Media/)
  })

  it('flips from present to absent when thumbnails toggle off', async () => {
    await mountView([VIDEO_ENTRY])
    await mountThumbnailsFor([VIDEO_ENTRY.name])

    const videos = document.querySelectorAll('video')
    driveVideoMetadata(videos[0])

    await waitFor(() => {
      expect(row(VIDEO_ENTRY.name).textContent).toMatch(/12:04\s*·\s*4K/)
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Options' }))
    const optionsMenu = await screen.findByRole('menu', { name: 'Browse options' })
    await user.click(within(optionsMenu).getByLabelText('Thumbnails'))

    await waitFor(() => {
      expect(document.querySelector('video')).toBeNull()
    })
    const updatedRow = row(VIDEO_ENTRY.name)
    expect(updatedRow.textContent).not.toMatch(/\b\d{1,2}:\d{2}\b/)
    expect(updatedRow.textContent).not.toMatch(/\d+\s*×\s*\d+/)
  })
})

// ── Case 7: Properties — Duration / Resolution / Dimensions ───────────────

describe('BrowseView — Properties surfaces media metadata', () => {
  it('shows Duration and Resolution for a video inside the Size-and-time section', async () => {
    const user = userEvent.setup()
    await mountView([VIDEO_ENTRY])
    await mountThumbnailsFor([VIDEO_ENTRY.name])

    const videos = document.querySelectorAll('video')
    driveVideoMetadata(videos[0])

    await waitFor(() => {
      expect(row(VIDEO_ENTRY.name).textContent).toMatch(/12:04\s*·\s*4K/)
    })

    // Open Properties for the video.
    await user.click(row(VIDEO_ENTRY.name).querySelector('.checkbox'))
    await user.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Properties' }))
    const dialog = await screen.findByRole('dialog', { name: 'clip.mp4 Properties' })

    // Size-and-time section is the home for the new rows. Both labels
    // must be present in the dialog; the values come from the live
    // thumbnail we drove above.
    await waitFor(() => {
      expect(within(dialog).getByText('Duration')).toBeTruthy()
      expect(within(dialog).getByText('Resolution')).toBeTruthy()
    })
  })

  it('shows Dimensions for an image inside the Size-and-time section', async () => {
    const user = userEvent.setup()
    await mountView([IMAGE_ENTRY])
    await mountThumbnailsFor([IMAGE_ENTRY.name])

    const imgs = document.querySelectorAll('img')
    driveImageMetadata(imgs[0])

    await waitFor(() => {
      expect(row(IMAGE_ENTRY.name).textContent).toMatch(/6000\s*×\s*4000/)
    })

    await user.click(row(IMAGE_ENTRY.name).querySelector('.checkbox'))
    await user.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Properties' }))
    const dialog = await screen.findByRole('dialog', { name: 'photo.jpg Properties' })

    await waitFor(() => {
      expect(within(dialog).getByText('Dimensions')).toBeTruthy()
    })
    expect(within(dialog).getByText(/6000\s*×\s*4000/)).toBeTruthy()
  })
})

// ── Case 8: No new IPC beyond what the thumbnail already makes ────────────

describe('BrowseView — surfacing media metadata costs no extra IPC', () => {
  it('does not call entryInfo or list again when video metadata arrives', async () => {
    await mountView([VIDEO_ENTRY])
    await mountThumbnailsFor([VIDEO_ENTRY.name])

    // Watch the IPC surface that Properties used to reach out to for
    // every missing attribute. If the new metadata path adds a similar
    // round trip, this spy catches it.
    const entryInfo = vi.fn().mockResolvedValue({
      ok: true, mode: '755', owner: 'user', group: 'users', created: null, isSymlink: false, symlinkTarget: null,
    })
    window.winraid.remote.entryInfo = entryInfo

    const listSpy = window.winraid.remote.list
    const listCallsAfterMount = listSpy.mock.calls.length

    const videos = document.querySelectorAll('video')
    driveVideoMetadata(videos[0])

    await waitFor(() => {
      expect(row(VIDEO_ENTRY.name).textContent).toMatch(/12:04\s*·\s*4K/)
    })

    // Drive metadata twice — surfacing the value across re-renders must
    // never trigger a follow-up fetch either.
    driveVideoMetadata(videos[0])
    await waitFor(() => {
      expect(entryInfo).not.toHaveBeenCalled()
    })
    expect(listSpy.mock.calls.length).toBe(listCallsAfterMount)
  })

  it('does not call entryInfo or list when image metadata arrives', async () => {
    await mountView([IMAGE_ENTRY])
    await mountThumbnailsFor([IMAGE_ENTRY.name])

    const entryInfo = vi.fn().mockResolvedValue({
      ok: true, mode: '755', owner: 'user', group: 'users', created: null, isSymlink: false, symlinkTarget: null,
    })
    window.winraid.remote.entryInfo = entryInfo

    const listSpy = window.winraid.remote.list
    const listCallsAfterMount = listSpy.mock.calls.length

    const imgs = document.querySelectorAll('img')
    driveImageMetadata(imgs[0])
    driveImageMetadata(imgs[0])

    await waitFor(() => {
      expect(row(IMAGE_ENTRY.name).textContent).toMatch(/6000\s*×\s*4000/)
    })

    expect(entryInfo).not.toHaveBeenCalled()
    expect(listSpy.mock.calls.length).toBe(listCallsAfterMount)
  })
})
