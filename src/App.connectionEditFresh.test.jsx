import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import App from './App'
import { createWinraidMock } from './__mocks__/winraid'

// Contract under test — the connection editor saves the whole connection
// object, so it must start from what config holds, not from App's in-memory
// list. Browse writes per-connection state (view options, the sync root)
// straight to config without passing through App; an editor seeded from
// App's copy would carry the pre-Browse values and its Save would quietly
// revert them.
//
// The real ConnectionView runs here: the outcome that matters is what Save
// leaves in config.

vi.mock('./views/ConnectionsView', () => ({
  default: ({ connections, onEditConnection }) => (
    <div data-testid="connections-view">
      {connections.map((c) => (
        <button key={c.id} data-testid={`edit-${c.id}`} onClick={() => onEditConnection?.(c)}>
          Edit {c.name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('./views/BrowseView',    () => ({ default: () => <div /> }))
vi.mock('./views/SizeView',      () => ({ default: () => <div /> }))
vi.mock('./views/BackupView',    () => ({ default: () => <div /> }))
vi.mock('./views/SettingsView',  () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView', () => ({ default: () => <div /> }))
vi.mock('./views/QueueView',     () => ({ default: () => <div /> }))
vi.mock('./views/LogView',       () => ({ default: () => <div /> }))
vi.mock('./components/PlayOverlay', () => ({ default: () => <div /> }))
vi.mock('./components/EditorView',  () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

function makeConnection(overrides = {}) {
  return {
    id: 'c1', name: 'Atlas', icon: null, type: 'sftp',
    sftp: { host: 'nas.local', port: 22, username: 'u', password: '', keyPath: '', remotePath: '/mnt/user/media' },
    smb: { host: '', share: '', username: '', password: '', remotePath: '' },
    localFolder: '', operation: 'copy', folderMode: 'mirror_clean',
    extensions: [], ignoredExtensions: [], renameDuplicates: true,
    ...overrides,
  }
}

let configStore

function setup() {
  configStore = { connections: [makeConnection()], activeConnectionId: 'c1', defaultConnection: null, favoritesByConnection: {} }
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn(async (key) => {
        if (key === undefined) return structuredClone(configStore)
        if (key === 'appearance') return { theme: 'dark', accent: 'orange' }
        if (key === 'playDefaults') return { recursive: true, shuffle: false }
        return structuredClone(configStore[key])
      }),
      set: vi.fn(async (key, value) => { configStore[key] = structuredClone(value) }),
    },
  })
  window.winraid.tray  = { onOpenConnection: vi.fn(() => () => {}), openFlyout: vi.fn() }
  window.winraid.cache = {
    thumbSize:      vi.fn(async () => ({ bytes: 0 })),
    clearThumbs:    vi.fn(async () => {}),
    invalidateFile: vi.fn(async () => ({ ok: true })),
  }
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}

afterEach(() => { delete window.winraid })

async function openConnectionsScreen() {
  setup()
  render(<App />)
  await act(async () => {})
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name: 'Connections' }))
  await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
}

// What Browse does: a whole-list write that App never hears about.
async function browseWrites(patch) {
  await act(async () => {
    await window.winraid.config.set('connections', configStore.connections.map((c) => ({ ...c, ...patch(c) })))
  })
}

async function editAndSaveUnchanged() {
  fireEvent.click(screen.getByTestId('edit-c1'))
  await waitFor(() => expect(screen.getByRole('button', { name: /^save/i })).toBeTruthy())
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^save/i })) })
  await act(async () => {})
}

describe('the connection editor starts from what config holds', () => {
  it('keeps Browse view options written after App loaded its list', async () => {
    await openConnectionsScreen()
    await browseWrites(() => ({ browseOptions: { density: 'compact', thumbnails: false } }))

    await editAndSaveUnchanged()

    const saved = configStore.connections.find((c) => c.id === 'c1')
    expect(saved.browseOptions).toEqual({ density: 'compact', thumbnails: false })
    expect(saved.renameDuplicates).toBe(true)
  })

  it('keeps a sync root set from Browse after App loaded its list', async () => {
    await openConnectionsScreen()
    await browseWrites((c) => ({ sftp: { ...c.sftp, remotePath: '/mnt/user/media/tv' } }))

    await editAndSaveUnchanged()

    expect(configStore.connections.find((c) => c.id === 'c1').sftp.remotePath).toBe('/mnt/user/media/tv')
  })
})
