import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test — "Open folder" in the play wall's viewer lands you
// in the browser at that file's folder. A recursive wall walks files from
// all over the tree, so the folder a file lives in is often nowhere near
// what the browser last showed.
//
//   - the wall passes Quick Look an onOpenFolder callback
//   - acting on it opens (or activates) a browse tab for the wall's
//     connection, pointed at that folder, and leaves the wall

vi.mock('./views/SizeView',        () => ({ default: () => <div data-testid="size-view" /> }))
vi.mock('./views/BackupView',      () => ({ default: () => <div data-testid="backup-view" /> }))
vi.mock('./views/ConnectionsView', () => ({ default: () => <div data-testid="connections-view" /> }))
vi.mock('./views/ConnectionView',  () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView',   () => ({ default: () => <div data-testid="dashboard-view" /> }))
vi.mock('./views/QueueView',       () => ({ default: () => <div data-testid="queue-view" /> }))
vi.mock('./views/LogView',         () => ({ default: () => <div data-testid="logs-view" /> }))
vi.mock('./views/SettingsView',    () => ({ default: () => <div data-testid="settings-view" /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

vi.mock('./views/BrowseView', () => ({
  default: ({ connectionId, browseRestore }) => (
    <div data-testid="browse-view">
      browse:{connectionId}:{browseRestore ? String(browseRestore.path) : 'root'}
    </div>
  ),
}))

// The wall is real; only its viewer is stubbed, so the test drives the
// callback the wall hands down rather than Quick Look's own markup.
vi.mock('./components/QuickLookOverlay', () => ({
  default: ({ onOpenFolder, file }) => (
    <div data-testid="quick-look">
      <button data-testid="open-folder" onClick={() => onOpenFolder?.(file.path.slice(0, file.path.lastIndexOf('/')))}>
        open folder
      </button>
    </div>
  ),
}))

const noopSubscribe = () => () => {}
const CONNECTIONS = [{ id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/photos' } }]

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

let mediaFoundCallback
let savedIntersectionObserver
let savedResizeObserver

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  savedResizeObserver       = window.ResizeObserver
  window.IntersectionObserver     = ObserverStub
  window.ResizeObserver           = ObserverStub
  globalThis.IntersectionObserver = ObserverStub
  globalThis.ResizeObserver       = ObserverStub
  mediaFoundCallback = null
  window.winraid = {
    getVersion: vi.fn(async () => '3.0.0'),
    config: {
      get: vi.fn(async (key) => {
        if (key === 'appearance') return { theme: 'dark', accent: 'orange' }
        if (key === 'connections') return CONNECTIONS
        if (key === 'activeConnectionId') return 'c1'
        if (key === 'playDefaults') return { recursive: true, shuffle: false }
        return { connections: CONNECTIONS, activeConnectionId: 'c1', favoritesByConnection: {} }
      }),
      set: vi.fn(async () => {}),
    },
    system:   { accentColor: vi.fn(async () => null), onAccentColorChanged: vi.fn(() => () => {}) },
    window:   { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(async () => false), onMaximizedChanged: vi.fn(() => () => {}) },
    update:   { onStatus: noopSubscribe, check: vi.fn(), install: vi.fn() },
    whatsNew: { open: vi.fn(), close: vi.fn() },
    watcher:  { list: vi.fn(async () => ({})), onStatus: noopSubscribe, pauseAll: vi.fn(), resumeAll: vi.fn() },
    queue:    { list: vi.fn(async () => []), onProgress: noopSubscribe, onUpdated: noopSubscribe, pause: vi.fn(), resume: vi.fn() },
    backup:   { onProgress: noopSubscribe },
    activity: { reveal: vi.fn(), tail: vi.fn(async () => []), onEntry: noopSubscribe },
    cache:    { invalidateFile: vi.fn(async () => ({ ok: true })), thumbSize: vi.fn(async () => ({ bytes: 0 })), clearThumbs: vi.fn() },
    remote:   {
      mediaScan:    vi.fn(async () => ({ ok: true })),
      mediaCancel:  vi.fn(async () => ({ ok: true })),
      onMediaFound: vi.fn((callback) => { mediaFoundCallback = callback; return () => {} }),
      onMediaDone:  vi.fn(() => () => {}),
      onMediaError: vi.fn(() => () => {}),
      list:         vi.fn(async () => ({ ok: true, entries: [] })),
    },
  }
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
})

afterEach(() => {
  window.IntersectionObserver     = savedIntersectionObserver
  window.ResizeObserver           = savedResizeObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  globalThis.ResizeObserver       = savedResizeObserver
  delete window.winraid
})

function navButton(name) {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name })
}

async function clickNav(name) {
  fireEvent.click(navButton(name))
  await act(async () => {})
}

describe('open folder from the play wall viewer', () => {
  it('opens the browser at the folder the file lives in', async () => {
    render(<App />)
    await act(async () => {})
    await clickNav('Connections')
    await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
    await clickNav('Play wall')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Play' })).toBeTruthy())

    // A file two folders below the scan root arrives and is opened.
    act(() => { mediaFoundCallback?.({ files: [{ path: '/photos/2026/trip/a.jpg', size: 10, mtime: 0, type: 'image' }] }) })
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg', hidden: true }))
    await act(async () => {})
    expect(screen.getByTestId('quick-look')).toBeTruthy()

    fireEvent.click(screen.getByTestId('open-folder'))
    await act(async () => {})

    // The browser is showing that folder, and the wall is behind us.
    await waitFor(() => expect(screen.getByTestId('browse-view').textContent).toBe('browse:c1:/photos/2026/trip'))
    expect(screen.queryByRole('region', { name: 'Play' })).toBeNull()
    expect(navButton('Browse').getAttribute('aria-current')).toBe('page')
  })
})
