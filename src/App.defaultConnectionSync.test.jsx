import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'
import { createWinraidMock } from './__mocks__/winraid'

// Contract under test — the default connection is a single setting that
// every screen that opens on a connection has to agree on. The Connections
// ribbon and pin button lead the list, every ConnectionPicker has its own
// pin radio per row, and Browse/Backup/Size mount ConnectionPicker in the
// header.
//
// The value reaches disk when the user pins it from anywhere. The flaw is
// the read path: App seeds its in-memory default once from config on mount,
// and the renderers that show the default read that single state value. A
// later pin never reaches it, so the screens silently drift out of sync
// with what config holds. Every consumer keeps showing the previous pin
// for the rest of the session.
//
// What this suite asserts: without a remount, after a pin from one screen,
// every other screen that reads the default from App now reflects it. The
// saving path still writes config (no regression of the persisted write),
// and the pin path that already worked keeps working (no regression of the
// in-memory update that was always correct for the pinner's own screen).

vi.mock('./views/SettingsView', () => ({
  // Stub: exposes the same write the real Settings handler performs — the
  // rest of the contract is about what App does after that write, not what
  // the Settings form does. Saves are tested in SettingsView's own suite;
  // here we drive App's sync responsibility from the same observable input.
  default: () => (
    <div data-testid="settings-view">
      <button
        data-testid="settings-pin-c2"
        onClick={() => window.winraid?.config.set('defaultConnection', 'c2')}
      >
        pin c2
      </button>
      <button
        data-testid="settings-pin-null"
        onClick={() => window.winraid?.config.set('defaultConnection', null)}
      >
        pin null
      </button>
    </div>
  ),
}))

vi.mock('./views/ConnectionsView', () => ({
  default: ({ defaultConnectionId, connections, onSetDefault }) => (
    <div data-testid="connections-view">
      <span data-testid="connections-default">{defaultConnectionId ?? 'null'}</span>
      {connections.map((c) => (
        <button
          key={c.id}
          data-testid={`connections-pin-${c.id}`}
          aria-pressed={c.id === defaultConnectionId}
          onClick={() => onSetDefault?.(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('./views/BrowseView', () => ({
  default: ({ defaultConnectionId }) => (
    <div data-testid="browse-view">
      <span data-testid="browse-default">{defaultConnectionId ?? 'null'}</span>
    </div>
  ),
}))

vi.mock('./views/SizeView', () => ({
  default: ({ defaultConnectionId }) => (
    <div data-testid="size-view">
      <span data-testid="size-default">{defaultConnectionId ?? 'null'}</span>
    </div>
  ),
}))

vi.mock('./views/BackupView', () => ({
  default: ({ defaultConnectionId }) => (
    <div data-testid="backup-view">
      <span data-testid="backup-default">{defaultConnectionId ?? 'null'}</span>
    </div>
  ),
}))

vi.mock('./components/PlayOverlay', () => ({
  default: ({ defaultConnectionId }) => (
    <div data-testid="play-overlay">
      <span data-testid="play-default">{defaultConnectionId ?? 'null'}</span>
    </div>
  ),
}))

vi.mock('./views/ConnectionView', () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView', () => ({ default: () => <div data-testid="dashboard-view" /> }))
vi.mock('./views/QueueView',     () => ({ default: () => <div data-testid="queue-view" /> }))
vi.mock('./views/LogView',       () => ({ default: () => <div data-testid="logs-view" /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

const noopSubscribe = () => () => {}

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas',   type: 'sftp', sftp: { remotePath: '/root/c1' } },
  { id: 'c2', name: 'Vault',   type: 'sftp', sftp: { remotePath: '/root/c2' } },
  { id: 'c3', name: 'Archive', type: 'sftp', sftp: { remotePath: '/root/c3' } },
]

let configStore

function setup({ defaultConnection = null, activeConnectionId = 'c1', connections = CONNECTIONS } = {}) {
  configStore = { connections, activeConnectionId, defaultConnection, favoritesByConnection: {} }
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn(async (key) => {
        if (key === undefined) return { ...configStore }
        if (key === 'appearance') return { theme: 'dark', accent: 'orange' }
        if (key === 'playDefaults') return { recursive: true, shuffle: false }
        return configStore[key]
      }),
      set: vi.fn(async (key, value) => { configStore[key] = value }),
    },
  })
  // The mock helper returns no-op systems, but App calls a few specific
  // methods on a couple of them — make sure they're there in case future
  // tests start to lean on them.
  window.winraid.tray  = { onOpenConnection: vi.fn(() => () => {}), openFlyout: vi.fn() }
  window.winraid.cache = {
    thumbSize:      vi.fn(async () => ({ bytes: 0 })),
    clearThumbs:    vi.fn(async () => {}),
    invalidateFile: vi.fn(async () => ({ ok: true })),
  }
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
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

async function mountApp(opts) {
  setup(opts)
  render(<App />)
  await act(async () => {})
}

describe('the default connection setting stays in sync across screens', () => {
  it('changes the default on Connections the moment Settings pins a new one, with no remount', async () => {
    await mountApp({ defaultConnection: 'c1' })

    // Pin c2 from the Settings screen.
    await clickNav('Settings')
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy())
    fireEvent.click(screen.getByTestId('settings-pin-c2'))
    await act(async () => {})

    // Switch to Connections — same App instance, no remount — and the
    // ribbon/pin state for the new default must be on, not the old one.
    await clickNav('Connections')
    await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
    expect(screen.getByTestId('connections-default').textContent).toBe('c2')
    expect(screen.getByTestId('connections-pin-c2').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('connections-pin-c1').getAttribute('aria-pressed')).toBe('false')
  })

  it('changes the pin state of every connection picker the moment Settings pins a new one', async () => {
    await mountApp({ defaultConnection: 'c1' })

    // Pin from Settings.
    await clickNav('Settings')
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy())
    fireEvent.click(screen.getByTestId('settings-pin-c2'))
    await act(async () => {})

    // Open a per-connection screen that mounts a ConnectionPicker. The
    // picker's header and row pin radios all read defaultConnectionId from
    // App — they must reflect the new pin immediately.
    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view')).toBeTruthy())
    await clickNav('Backup')
    await waitFor(() => expect(screen.getByTestId('backup-view')).toBeTruthy())
    await clickNav('Size map')
    await waitFor(() => expect(screen.getByTestId('size-view')).toBeTruthy())
    await clickNav('Play wall')
    await waitFor(() => expect(screen.getByTestId('play-overlay')).toBeTruthy())

    expect(screen.getByTestId('browse-default').textContent).toBe('c2')
    expect(screen.getByTestId('backup-default').textContent).toBe('c2')
    expect(screen.getByTestId('size-default').textContent).toBe('c2')
    expect(screen.getByTestId('play-default').textContent).toBe('c2')
  })

  it('still persists the change to config when the pin is done in Settings', async () => {
    await mountApp({ defaultConnection: 'c1' })

    await clickNav('Settings')
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy())
    fireEvent.click(screen.getByTestId('settings-pin-c2'))
    await act(async () => {})

    // The save path does not regress — config is the source of truth and
    // the write still lands there even after the fix.
    expect(window.winraid.config.set).toHaveBeenCalledWith('defaultConnection', 'c2')
    expect(configStore.defaultConnection).toBe('c2')
  })

  it('keeps working when the default is cleared back to "last used" from Settings', async () => {
    await mountApp({ defaultConnection: 'c2' })

    await clickNav('Settings')
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy())
    fireEvent.click(screen.getByTestId('settings-pin-null'))
    await act(async () => {})

    await clickNav('Connections')
    await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
    expect(screen.getByTestId('connections-default').textContent).toBe('null')

    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view')).toBeTruthy())
    expect(screen.getByTestId('browse-default').textContent).toBe('null')
  })

  it('propagates a pin from Connections to every ConnectionPicker the same way Settings does', async () => {
    // Reverse direction: the path that was already correct must still be
    // correct after the fix. Pinning from the Connections pin must reach
    // every screen that reads defaultConnectionId from App.
    await mountApp({ defaultConnection: 'c1' })

    await clickNav('Connections')
    await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connections-pin-c3'))
    await act(async () => {})

    // Connections itself must show the new default immediately.
    expect(screen.getByTestId('connections-default').textContent).toBe('c3')

    await clickNav('Browse')
    await waitFor(() => expect(screen.getByTestId('browse-view')).toBeTruthy())
    await clickNav('Backup')
    await waitFor(() => expect(screen.getByTestId('backup-view')).toBeTruthy())
    await clickNav('Size map')
    await waitFor(() => expect(screen.getByTestId('size-view')).toBeTruthy())
    await clickNav('Play wall')
    await waitFor(() => expect(screen.getByTestId('play-overlay')).toBeTruthy())

    expect(screen.getByTestId('browse-default').textContent).toBe('c3')
    expect(screen.getByTestId('backup-default').textContent).toBe('c3')
    expect(screen.getByTestId('size-default').textContent).toBe('c3')
    expect(screen.getByTestId('play-default').textContent).toBe('c3')
  })
})
