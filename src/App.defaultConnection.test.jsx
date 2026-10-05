import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test — which connection a connection-driven screen opens on
// is a setting, not a guess.
//
// Browse, Backup, Size and the Play wall all have to pick a connection when
// you reach them from the nav rail. That choice used to be inferred: the last
// connection explicitly picked from a switcher, falling back to whichever
// happened to be first in the list. Nothing recorded a choice until a
// switcher was used, so a fresh install always opened the first connection,
// and working inside a tab never counted as choosing it.
//
// `defaultConnection` settles it:
//   - a connection id pins every connection-driven screen to that connection
//   - `null` means "last used", which is the previous behaviour, now an
//     explicit choice rather than the only one
//   - "last used" counts actually being in a connection, not just picking it
//     from a switcher
//   - a pinned connection that no longer exists falls back rather than
//     leaving the screens with nothing

vi.mock('./views/BrowseView', () => ({
  default: ({ connectionId }) => <div data-testid="browse-view">browse:{connectionId}</div>,
}))
vi.mock('./views/BackupView', () => ({
  default: ({ connectionId }) => <div data-testid="backup-view">backup:{connectionId}</div>,
}))
vi.mock('./views/SizeView', () => ({
  default: ({ connectionId }) => <div data-testid="size-view">size:{connectionId}</div>,
}))
vi.mock('./components/PlayOverlay', () => ({
  default: ({ connectionId }) => <div data-testid="play-overlay">play:{connectionId}</div>,
}))
vi.mock('./views/ConnectionsView', () => ({ default: () => <div data-testid="connections-view" /> }))
vi.mock('./views/ConnectionView',  () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView',   () => ({ default: () => <div data-testid="dashboard-view" /> }))
vi.mock('./views/QueueView',       () => ({ default: () => <div data-testid="queue-view" /> }))
vi.mock('./views/LogView',         () => ({ default: () => <div data-testid="logs-view" /> }))
vi.mock('./views/SettingsView',    () => ({ default: () => <div data-testid="settings-view" /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

const noopSubscribe = () => () => {}

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/root/c1' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { remotePath: '/root/c2' } },
  { id: 'c3', name: 'Archive', type: 'sftp', sftp: { remotePath: '/root/c3' } },
]

let configStore

function mountApp({ defaultConnection = null, activeConnectionId = null, connections = CONNECTIONS } = {}) {
  configStore = { connections, activeConnectionId, defaultConnection, favoritesByConnection: {} }
  window.winraid = {
    getVersion: vi.fn(async () => '3.0.0'),
    config: {
      get: vi.fn(async (key) => {
        if (key === undefined) return { ...configStore }
        if (key === 'appearance') return { theme: 'dark', accent: 'orange' }
        if (key === 'playDefaults') return { recursive: true, shuffle: false }
        return configStore[key]
      }),
      set: vi.fn(async (key, value) => { configStore[key] = value }),
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
      list: vi.fn(async () => ({ ok: true, entries: [] })),
      mediaScan: vi.fn(async () => ({ ok: true })),
      mediaCancel: vi.fn(async () => ({ ok: true })),
      onMediaFound: vi.fn(() => () => {}),
      onMediaDone: vi.fn(() => () => {}),
      onMediaError: vi.fn(() => () => {}),
    },
  }
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
  render(<App />)
}

beforeEach(() => { configStore = null })
afterEach(() => { delete window.winraid })

function navButton(name) {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name })
}

async function clickNav(name) {
  fireEvent.click(navButton(name))
  await act(async () => {})
}

describe('the default connection setting', () => {
  it('opens the browser on the pinned connection, not the first in the list', async () => {
    mountApp({ defaultConnection: 'c3' })
    await act(async () => {})
    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view').textContent).toBe('browse:c3'))
  })

  it('pins every connection-driven screen, not just the browser', async () => {
    mountApp({ defaultConnection: 'c2' })
    await act(async () => {})

    await clickNav('Backup')
    await waitFor(() => expect(screen.getByTestId('backup-view').textContent).toBe('backup:c2'))

    await clickNav('Size map')
    await waitFor(() => expect(screen.getByTestId('size-view').textContent).toBe('size:c2'))

    await clickNav('Play wall')
    await waitFor(() => expect(screen.getByTestId('play-overlay').textContent).toBe('play:c2'))
  })

  it('beats the last-used connection when both are set', async () => {
    mountApp({ defaultConnection: 'c3', activeConnectionId: 'c1' })
    await act(async () => {})
    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view').textContent).toBe('browse:c3'))
  })

  it('falls back to the last used connection when set to "last used"', async () => {
    mountApp({ defaultConnection: null, activeConnectionId: 'c2' })
    await act(async () => {})
    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view').textContent).toBe('browse:c2'))
  })

  it('falls back to the first connection when nothing is pinned or remembered', async () => {
    mountApp({ defaultConnection: null, activeConnectionId: null })
    await act(async () => {})
    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view').textContent).toBe('browse:c1'))
  })

  it('falls back rather than breaking when the pinned connection is gone', async () => {
    mountApp({ defaultConnection: 'deleted-one', activeConnectionId: 'c2' })
    await act(async () => {})
    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view').textContent).toBe('browse:c2'))
  })

  it('does not let a pinned choice drift when a screen is opened', async () => {
    mountApp({ defaultConnection: 'c3' })
    await act(async () => {})
    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view').textContent).toBe('browse:c3'))
    expect(configStore.defaultConnection).toBe('c3')
  })
})
