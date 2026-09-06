import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test — tabs behave the way a browser's do. A plain click
// on a nav item reuses that connection's tab; a middle click always opens
// another one, so the same folder tree can be open twice side by side. Each
// tab carries its own history, so the second tab starts empty rather than
// inheriting the first one's trail.
//
//   - a tab's identity is its own, not "<connection>:<type>", so a
//     connection can have several tabs of the same kind at once
//   - clicking a nav item twice keeps one tab; middle-clicking opens a new
//     one and makes it active
//   - a tab opened in the background (middle click from inside the browser)
//     does not steal the active tab
//   - back and forward stay inside the tab that owns the trail

vi.mock('./views/BrowseView', () => {
  function BrowseStub({ browseRestore, onHistoryPush, onOpenTab, connectionId }) {
    const pushedInitial = useRef(false)
    useEffect(() => {
      if (pushedInitial.current) return
      pushedInitial.current = true
      onHistoryPush?.({ kind: 'browse', path: `/root/${connectionId}`, quickLookFile: null, connectionId })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-once push, guarded by the ref
    return (
      <div data-testid="browse-view">
        <span data-testid="restore-path">{browseRestore ? String(browseRestore.path) : 'none'}</span>
        <button
          data-testid="go-deeper"
          onClick={() => onHistoryPush?.({ kind: 'browse', path: `/root/${connectionId}/deep`, quickLookFile: null, connectionId })}
        >
          deeper
        </button>
        <button
          data-testid="open-folder-in-new-tab"
          onClick={() => onOpenTab?.(connectionId, 'browse', { path: `/root/${connectionId}/photos`, newTab: true, background: true })}
        >
          background tab
        </button>
      </div>
    )
  }
  return { default: BrowseStub }
})

vi.mock('./views/SizeView',        () => ({ default: ({ connectionId }) => <div data-testid="size-view">size:{connectionId}</div> }))
vi.mock('./views/BackupView',      () => ({ default: ({ connectionId }) => <div data-testid="backup-view">backup:{connectionId}</div> }))
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

async function middleClickNav(name) {
  fireEvent.mouseDown(navButton(name), { button: 1 })
  await act(async () => {})
}

function tabs() {
  return Array.from(document.querySelectorAll('[data-tabid]'))
}

function activeTab() {
  return tabs().find((tab) => tab.className.includes('tabActive')) ?? null
}

async function mountApp() {
  render(<App />)
  await act(async () => {})
  await clickNav('Connections')
  await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
  await clickNav('Dashboard')
}

describe('tabs', () => {
  it('reuses the tab when the same nav item is clicked twice', async () => {
    await mountApp()
    await clickNav('Browse')
    await clickNav('Dashboard')
    await clickNav('Browse')
    expect(tabs()).toHaveLength(1)
  })

  it('middle-clicking a nav item opens another tab of the same kind and activates it', async () => {
    await mountApp()
    await clickNav('Browse')
    const firstId = activeTab().getAttribute('data-tabid')
    await middleClickNav('Browse')
    expect(tabs()).toHaveLength(2)
    const secondId = activeTab().getAttribute('data-tabid')
    expect(secondId).not.toBe(firstId)
  })

  it('gives each tab an identity of its own rather than one per connection and kind', async () => {
    await mountApp()
    await clickNav('Browse')
    await middleClickNav('Browse')
    const ids = tabs().map((tab) => tab.getAttribute('data-tabid'))
    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('c1:browse')
  })

  it('opens a background tab without leaving the tab you are on', async () => {
    await mountApp()
    await clickNav('Browse')
    const firstId = activeTab().getAttribute('data-tabid')
    await act(async () => { fireEvent.click(screen.getByTestId('open-folder-in-new-tab')) })
    expect(tabs()).toHaveLength(2)
    expect(activeTab().getAttribute('data-tabid')).toBe(firstId)
  })

  it('middle-clicking a tab closes it', async () => {
    await mountApp()
    await clickNav('Browse')
    await middleClickNav('Browse')
    expect(tabs()).toHaveLength(2)
    fireEvent.mouseDown(tabs()[1], { button: 1 })
    await act(async () => {})
    expect(tabs()).toHaveLength(1)
  })

  it('keeps each tab history to itself, even between two tabs of the same connection', async () => {
    await mountApp()
    await clickNav('Browse')
    // Walk one folder deep in the first tab.
    fireEvent.click(screen.getAllByTestId('go-deeper')[0])
    await act(async () => {})

    // A second tab of the same connection starts with a trail of its own.
    await middleClickNav('Browse')
    const secondId = activeTab().getAttribute('data-tabid')
    fireEvent.mouseDown(window, { button: 3 })
    await act(async () => {})
    // Back did nothing here: the second tab has only its initial entry, and
    // the first tab's trail is not its to walk.
    expect(activeTab().getAttribute('data-tabid')).toBe(secondId)
    expect(tabs()).toHaveLength(2)
  })
})
