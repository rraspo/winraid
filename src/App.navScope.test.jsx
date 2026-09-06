import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test — back and forward stay inside the view you are in.
// Walking folders in a browse tab and then switching to Settings must not
// let Back drag you back into that folder trail, and each tab keeps its
// own position while you are away from it.

vi.mock('./views/BrowseView', () => {
  function BrowseStub({ browseRestore, onHistoryPush, connectionId }) {
    const pushedInitial = useRef(false)
    useEffect(() => {
      if (pushedInitial.current) return
      pushedInitial.current = true
      onHistoryPush?.({ kind: 'browse', path: `/root/${connectionId}`, quickLookFile: null, connectionId })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-once push, guarded by the ref
    return (
      <div>
        <span data-testid={`restore-${connectionId}`}>{browseRestore ? String(browseRestore.path) : 'none'}</span>
        <button
          data-testid={`deeper-${connectionId}`}
          onClick={() => onHistoryPush?.({ kind: 'browse', path: `/root/${connectionId}/deep`, quickLookFile: null, connectionId })}
        >
          deeper
        </button>
      </div>
    )
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
  }
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
})

afterEach(() => { delete window.winraid })

function navButton(name) {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name })
}

async function clickNav(name) {
  fireEvent.click(navButton(name))
  await act(async () => {})
}

function pressMouseBack() {
  fireEvent.mouseDown(window, { button: 3 })
}

async function mountApp() {
  render(<App />)
  await act(async () => {})
  await clickNav('Connections')
  await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
  await clickNav('Dashboard')
}

describe('App history is scoped to the view', () => {
  it('back does nothing in a view that has no history of its own', async () => {
    await mountApp()
    await clickNav('Browse')
    fireEvent.click(screen.getByTestId('deeper-c1'))
    await act(async () => {})

    await clickNav('Settings')
    expect(screen.getByTestId('settings-view')).toBeTruthy()

    pressMouseBack()
    await act(async () => {})
    // Still on Settings: the browse tab's trail is not this view's history.
    // The tab stays mounted behind the view, so the nav rail is what says
    // where you are.
    expect(navButton('Settings').getAttribute('aria-current')).toBe('page')
    expect(navButton('Browse').getAttribute('aria-current')).toBeNull()
  })

  it('a browse tab keeps its own position while you are away from it', async () => {
    await mountApp()
    await clickNav('Browse')
    fireEvent.click(screen.getByTestId('deeper-c1'))
    await act(async () => {})

    await clickNav('Settings')
    await clickNav('Browse')

    pressMouseBack()
    await waitFor(() => expect(screen.getByTestId('restore-c1')).toHaveTextContent('/root/c1'))
  })
})
