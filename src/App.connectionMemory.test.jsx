import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test — the connection switcher remembers. Choosing a
// connection anywhere makes it the default the next screen opens on, and
// it survives a restart, so the app stops falling back to the first
// connection in the list once the user has expressed a preference.
//
//   - choosing a connection persists it as config `activeConnectionId`
//   - the nav rail then opens per-connection screens on that connection
//   - a fresh start opens on the remembered one

vi.mock('./views/BrowseView', () => ({
  default: ({ connectionId }) => <div data-testid="browse-view">browse:{connectionId}</div>,
}))
vi.mock('./views/SizeView', () => ({
  default: ({ connectionId, onSelectConnection }) => (
    <div data-testid="size-view">
      size:{connectionId}
      <button data-testid="size-pick-c2" onClick={() => onSelectConnection('c2')}>pick</button>
    </div>
  ),
}))
vi.mock('./views/BackupView',      () => ({ default: ({ connectionId }) => <div data-testid="backup-view">backup:{connectionId}</div> }))
vi.mock('./views/ConnectionsView', () => ({ default: () => <div data-testid="connections-view" /> }))
vi.mock('./views/ConnectionView',  () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView',   () => ({ default: () => <div data-testid="dashboard-view" /> }))
vi.mock('./views/QueueView',       () => ({ default: () => <div data-testid="queue-view" /> }))
vi.mock('./views/LogView',         () => ({ default: () => <div data-testid="logs-view" /> }))
vi.mock('./views/SettingsView',    () => ({ default: () => <div data-testid="settings-view" /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/PlayOverlay', () => ({ default: ({ connectionId }) => <div data-testid="play-overlay">play:{connectionId}</div> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

const noopSubscribe = () => () => {}

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/root/c1' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { remotePath: '/root/c2' } },
]

let storedActiveId

function setup({ activeConnectionId = null } = {}) {
  storedActiveId = activeConnectionId
  window.winraid = {
    getVersion: vi.fn(async () => '3.0.0'),
    config: {
      get: vi.fn(async (key) => {
        if (key === 'appearance') return { theme: 'dark', accent: 'orange' }
        if (key === 'connections') return CONNECTIONS
        if (key === 'activeConnectionId') return storedActiveId
        return { connections: CONNECTIONS, activeConnectionId: storedActiveId, favoritesByConnection: {} }
      }),
      set: vi.fn(async (key, value) => { if (key === 'activeConnectionId') storedActiveId = value }),
    },
    system:   { accentColor: vi.fn(async () => null), onAccentColorChanged: vi.fn(() => () => {}) },
    window:   { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(async () => false), onMaximizedChanged: vi.fn(() => () => {}) },
    update:   { onStatus: noopSubscribe, check: vi.fn(), install: vi.fn() },
    whatsNew: { open: vi.fn(), close: vi.fn() },
    watcher:  { list: vi.fn(async () => ({})), onStatus: noopSubscribe, pauseAll: vi.fn(), resumeAll: vi.fn() },
    queue:    { list: vi.fn(async () => []), onProgress: noopSubscribe, onUpdated: noopSubscribe, pause: vi.fn(), resume: vi.fn() },
    backup:   { onProgress: noopSubscribe },
    activity: { reveal: vi.fn(), tail: vi.fn(async () => []), onEntry: noopSubscribe },
  }
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
}

beforeEach(() => setup())
afterEach(() => { delete window.winraid })

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

describe('the connection switcher remembers the last choice', () => {
  it('opens the first connection when nothing has been chosen yet', async () => {
    await mountApp()
    await clickNav('Size map')
    expect(screen.getByTestId('size-view').textContent).toContain('size:c1')
  })

  it('persists the chosen connection', async () => {
    await mountApp()
    await clickNav('Size map')
    await act(async () => { fireEvent.click(screen.getByTestId('size-pick-c2')) })
    expect(window.winraid.config.set).toHaveBeenCalledWith('activeConnectionId', 'c2')
  })

  it('opens the next per-connection screen on the remembered connection', async () => {
    await mountApp()
    await clickNav('Size map')
    await act(async () => { fireEvent.click(screen.getByTestId('size-pick-c2')) })
    await clickNav('Backup')
    await waitFor(() => expect(screen.getByTestId('backup-view').textContent).toContain('backup:c2'))
    await clickNav('Play wall')
    await waitFor(() => expect(screen.getByTestId('play-overlay').textContent).toContain('play:c2'))
  })

  it('starts on the remembered connection after a restart', async () => {
    setup({ activeConnectionId: 'c2' })
    await mountApp()
    await clickNav('Size map')
    await waitFor(() => expect(screen.getByTestId('size-view').textContent).toContain('size:c2'))
  })
})
