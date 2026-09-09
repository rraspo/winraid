import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test — the play wall is a screen, not a curtain. It opens
// in the content column like every other screen, so the nav rail stays
// visible and usable while it is up. Covering the whole window is what the
// wall's own Fullscreen control is for.
//
//   - opening the play wall leaves the nav rail present, with its Play wall
//     item marked current
//   - another nav item can be reached without closing the wall first
//   - Fullscreen marks the wall as covering the window; leaving fullscreen
//     brings the rail back

vi.mock('./views/BrowseView',      () => ({ default: () => <div data-testid="browse-view" /> }))
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

const noopSubscribe = () => () => {}
const CONNECTIONS = [{ id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/root/c1' } }]

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

let savedIntersectionObserver
let savedResizeObserver

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  savedResizeObserver       = window.ResizeObserver
  window.IntersectionObserver     = ObserverStub
  window.ResizeObserver           = ObserverStub
  globalThis.IntersectionObserver = ObserverStub
  globalThis.ResizeObserver       = ObserverStub
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
      onMediaFound: vi.fn(() => () => {}),
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

function rail() {
  return screen.queryByRole('navigation', { name: 'Primary' })
}

function navButton(name) {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name })
}

async function clickNav(name) {
  fireEvent.click(navButton(name))
  await act(async () => {})
}

async function mountApp() {
  render(<App />)
  await act(async () => {})
  await clickNav('Connections')
  await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
  await clickNav('Dashboard')
}

async function openPlayWall() {
  await clickNav('Play wall')
  await waitFor(() => expect(screen.getByRole('region', { name: 'Play' })).toBeTruthy())
}

describe('the play wall is a screen, not a curtain', () => {
  it('keeps the nav rail visible and marks Play wall as current', async () => {
    await mountApp()
    await openPlayWall()
    expect(rail()).toBeTruthy()
    expect(navButton('Play wall').getAttribute('aria-current')).toBe('page')
  })

  it('lets another screen be reached without closing the wall first', async () => {
    await mountApp()
    await openPlayWall()
    await clickNav('Queue')
    expect(screen.getByTestId('queue-view')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Play' })).toBeNull()
  })

  it('covers the window only while Fullscreen is on', async () => {
    await mountApp()
    await openPlayWall()
    const wall = screen.getByRole('region', { name: 'Play' })
    expect(wall.getAttribute('data-fullscreen')).not.toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle fullscreen' }))
    await act(async () => {})
    expect(screen.getByRole('region', { name: 'Play' }).getAttribute('data-fullscreen')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle fullscreen' }))
    await act(async () => {})
    expect(screen.getByRole('region', { name: 'Play' }).getAttribute('data-fullscreen')).not.toBe('true')
    expect(rail()).toBeTruthy()
  })

  it('Escape leaves fullscreen before it leaves the wall', async () => {
    await mountApp()
    await openPlayWall()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle fullscreen' }))
    await act(async () => {})

    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => {})
    const wall = screen.getByRole('region', { name: 'Play' })
    expect(wall.getAttribute('data-fullscreen')).not.toBe('true')

    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => {})
    expect(screen.queryByRole('region', { name: 'Play' })).toBeNull()
  })
})
