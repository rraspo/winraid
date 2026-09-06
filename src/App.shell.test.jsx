import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test — App composes the redesigned shell: the frameless
// title bar on top, the nav rail on the left, the tab strip and content in
// the middle, the status bar at the bottom. The old sidebar and header are
// gone, so the nav rail is the only way to reach every screen:
//   - Dashboard, Connections, Queue, Logs, Settings switch the global view
//   - Browse, Size map and Backup open (or activate) that tab for the
//     active connection (config activeConnectionId, else the first one)
//   - Play wall opens Play for the active connection at its remote root and
//     closing it returns to the view that was showing
//   - Theme flips the resolved theme and persists it under appearance
//   - the Dashboard receives the pause-all control and the activity feed
//     that used to live in the header
// The shell components render for real; the views are stubbed.

vi.mock('./views/BrowseView', () => ({
  default: ({ connectionId }) => <div data-testid="browse-view">browse:{connectionId}</div>,
}))
vi.mock('./views/SizeView', () => ({
  default: ({ connectionId }) => <div data-testid="size-view">size:{connectionId}</div>,
}))
vi.mock('./views/BackupView', () => ({
  default: ({ connectionId }) => <div data-testid="backup-view">backup:{connectionId}</div>,
}))
vi.mock('./views/ConnectionsView', () => ({
  default: ({ connections }) => <div data-testid="connections-view">connections:{connections.length}</div>,
}))
vi.mock('./views/DashboardView', () => ({
  default: ({ onGlobalToggle, activityEntries, queuePaused }) => (
    <div data-testid="dashboard-view">
      <span data-testid="dashboard-props">
        {typeof onGlobalToggle}:{Array.isArray(activityEntries) ? 'feed' : 'nofeed'}:{String(queuePaused)}
      </span>
    </div>
  ),
}))
vi.mock('./views/QueueView',      () => ({ default: () => <div data-testid="queue-view" /> }))
vi.mock('./views/LogView',        () => ({ default: () => <div data-testid="logs-view" /> }))
vi.mock('./views/SettingsView',   () => ({ default: () => <div data-testid="settings-view" /> }))
vi.mock('./views/ConnectionView', () => ({ default: () => <div data-testid="connection-editor" /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))
vi.mock('./components/PlayOverlay', () => ({
  default: ({ connectionId, path, onClose }) => (
    <div data-testid="play-overlay">
      play:{connectionId}:{path}
      <button onClick={onClose}>close-play</button>
    </div>
  ),
}))

const noopSubscribe = () => () => {}

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { remotePath: '/mnt/user/docs' } },
]

function setup({ activeConnectionId = 'c2' } = {}) {
  window.winraid = {
    getVersion: vi.fn(async () => '2.8.0'),
    config: {
      get: vi.fn(async (key) => {
        if (key === 'appearance') return { theme: 'dark', accent: 'orange' }
        if (key === 'connections') return CONNECTIONS
        if (key === 'activeConnectionId') return activeConnectionId
        return { connections: CONNECTIONS, activeConnectionId, favoritesByConnection: {} }
      }),
      set: vi.fn(async () => {}),
    },
    system:   { accentColor: vi.fn(async () => null), onAccentColorChanged: vi.fn(() => () => {}) },
    window:   {
      minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn(async () => false), onMaximizedChanged: vi.fn(() => () => {}),
    },
    update:   { onStatus: noopSubscribe, check: vi.fn(), install: vi.fn() },
    whatsNew: { open: vi.fn(), close: vi.fn() },
    watcher:  { list: vi.fn(async () => ({})), onStatus: noopSubscribe, pauseAll: vi.fn(), resumeAll: vi.fn() },
    queue:    { list: vi.fn(async () => []), onProgress: noopSubscribe, onUpdated: noopSubscribe, pause: vi.fn(), resume: vi.fn() },
    backup:   { onProgress: noopSubscribe },
    activity: { reveal: vi.fn(), tail: vi.fn(async () => []), onEntry: noopSubscribe },
  }
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
}

function navButton(name) {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name })
}

async function clickNav(name) {
  fireEvent.click(navButton(name))
  await act(async () => {})
}

beforeEach(() => {
  setup()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => { delete window.winraid })

async function mountAndSettle() {
  render(<App />)
  await act(async () => {})
  // Connections arrive asynchronously; the Connections screen reports the count.
  await clickNav('Connections')
  await waitFor(() => expect(screen.getByTestId('connections-view').textContent).toBe('connections:2'))
  await clickNav('Dashboard')
}

describe('App shell', () => {
  it('renders the title bar, the primary nav, the dashboard and the status bar with the version', async () => {
    await mountAndSettle()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
    expect(screen.getByTestId('dashboard-view')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('v2.8.0')
    expect(navButton('Dashboard').getAttribute('aria-current')).toBe('page')
  })

  it('switches the global views from the nav rail', async () => {
    await mountAndSettle()
    await clickNav('Queue')
    expect(screen.getByTestId('queue-view')).toBeTruthy()
    expect(navButton('Queue').getAttribute('aria-current')).toBe('page')
    await clickNav('Logs')
    expect(screen.getByTestId('logs-view')).toBeTruthy()
    await clickNav('Settings')
    expect(screen.getByTestId('settings-view')).toBeTruthy()
    await clickNav('Connections')
    expect(screen.getByTestId('connections-view')).toBeTruthy()
    expect(navButton('Connections').getAttribute('aria-current')).toBe('page')
  })

  it('opens Browse, Size map and Backup for the active connection', async () => {
    await mountAndSettle()
    await clickNav('Browse')
    expect(screen.getByTestId('browse-view').textContent).toBe('browse:c2')
    expect(navButton('Browse').getAttribute('aria-current')).toBe('page')
    await clickNav('Size map')
    expect(screen.getByTestId('size-view').textContent).toBe('size:c2')
    expect(navButton('Size map').getAttribute('aria-current')).toBe('page')
    await clickNav('Backup')
    expect(screen.getByTestId('backup-view').textContent).toBe('backup:c2')
    expect(navButton('Backup').getAttribute('aria-current')).toBe('page')
  })

  it('falls back to the first connection when none is marked active', async () => {
    setup({ activeConnectionId: null })
    await mountAndSettle()
    await clickNav('Browse')
    expect(screen.getByTestId('browse-view').textContent).toBe('browse:c1')
  })

  it('opens the play wall for the active connection at its remote root and returns on close', async () => {
    await mountAndSettle()
    await clickNav('Queue')
    await clickNav('Play wall')
    expect(screen.getByTestId('play-overlay').textContent).toContain('play:c2:/mnt/user/docs')
    expect(navButton('Play wall').getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByText('close-play'))
    await act(async () => {})
    expect(screen.queryByTestId('play-overlay')).toBeNull()
    expect(screen.getByTestId('queue-view')).toBeTruthy()
    expect(navButton('Queue').getAttribute('aria-current')).toBe('page')
  })

  it('flips the theme from the nav rail and persists it', async () => {
    await mountAndSettle()
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
    await clickNav('Theme')
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    expect(window.winraid.config.set).toHaveBeenCalledWith('appearance', { theme: 'light', accent: 'orange' })
  })

  it('hands the dashboard the pause-all control and the activity feed', async () => {
    await mountAndSettle()
    expect(screen.getByTestId('dashboard-props').textContent).toBe('function:feed:false')
  })

  it('closes the window through the title bar', async () => {
    await mountAndSettle()
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Close' }))
    expect(window.winraid.window.close).toHaveBeenCalledTimes(1)
  })
})
