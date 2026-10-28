import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'
import { setInternalDrag, clearInternalDrag } from './services/internalDrag'

// Files dragged out of one browse tab and dropped on another tab's header
// move into the folder that other tab is showing.

let mountedTabs = 0

vi.mock('./views/BrowseView', () => {
  function BrowseStub({ onLocationChange, connectionId }) {
    const folder = useRef(null)
    if (folder.current === null) folder.current = `/root/${connectionId}/tab${++mountedTabs}`
    useEffect(() => {
      onLocationChange?.({ connectionId, path: folder.current })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps -- reports the folder once, as a tab does on arrival
    return <div data-testid="browse-view" />
  }
  return { default: BrowseStub }
})

vi.mock('./views/SizeView',        () => ({ default: () => <div data-testid="size-view" /> }))
vi.mock('./views/BackupView',      () => ({ default: () => <div data-testid="backup-view" /> }))
vi.mock('./views/ConnectionsView', () => ({ default: () => <div data-testid="connections-view" /> }))
vi.mock('./views/ConnectionView',  () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView',   () => ({ default: () => <div data-testid="dashboard-view" /> }))
vi.mock('./views/QueueView',       () => ({ default: () => <div data-testid="queue-view" /> }))
vi.mock('./views/LogView',         () => ({ default: () => <div data-testid="logs-view" /> }))
vi.mock('./views/SettingsView',    () => ({ default: () => <div data-testid="settings-view" /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

const noopSubscribe = () => () => {}

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/root/c1' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { remotePath: '/root/c2' } },
]

beforeEach(() => {
  mountedTabs = 0
  window.winraid = {
    getVersion: vi.fn(async () => '3.0.0'),
    config: {
      get: vi.fn(async (key) => {
        if (key === 'appearance') return { theme: 'dark', accent: 'orange' }
        if (key === 'connections') return CONNECTIONS
        if (key === 'activeConnectionId') return 'c1'
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
    remote:   { move: vi.fn(async () => ({ ok: true })) },
  }
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
})

afterEach(() => {
  clearInternalDrag()
  delete window.winraid
})

function navButton(name) {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name })
}

async function clickNav(name) {
  fireEvent.click(navButton(name))
  await act(async () => {})
}

async function middleClickNav(name) {
  fireEvent.mouseDown(navButton(name), { button: 1 })
  await act(async () => {})
}

function activeTab() {
  return Array.from(document.querySelectorAll('[data-tabid]')).find((tab) => tab.className.includes('tabActive')) ?? null
}

// Two browse tabs on the first connection, the second one in front.
async function mountTwoBrowseTabs() {
  render(<App />)
  await act(async () => {})
  await clickNav('Connections')
  await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
  await clickNav('Browse')
  const firstTab = activeTab()
  await middleClickNav('Browse')
  expect(activeTab()).not.toBe(firstTab)
  return firstTab
}

describe('dropping files on a tab', () => {
  it('moves the dragged files into the folder the dropped-on tab is showing', async () => {
    const firstTab = await mountTwoBrowseTabs()

    setInternalDrag({ connectionId: 'c1', entries: [{ name: 'a.txt', entryPath: '/root/c1/tab2/a.txt' }] })
    fireEvent.dragOver(firstTab)
    await act(async () => { fireEvent.drop(firstTab) })

    await waitFor(() => expect(window.winraid.remote.move).toHaveBeenCalledWith('c1', '/root/c1/tab2/a.txt', '/root/c1/tab1/a.txt'))
  })

  it('moves nothing when the files come from another connection', async () => {
    const firstTab = await mountTwoBrowseTabs()

    setInternalDrag({ connectionId: 'c2', entries: [{ name: 'a.txt', entryPath: '/root/c2/a.txt' }] })
    fireEvent.dragOver(firstTab)
    await act(async () => { fireEvent.drop(firstTab) })

    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })
})
