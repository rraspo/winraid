import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'

// Contract under test: a browse tab is named after the folder it is showing,
// whichever way it got there. Walking into a folder, going back and going
// forward all rename the tab, and the connection's root reads as the
// connection's name.

// Behaves like BrowseView where it matters here: it reports its folder
// through onLocationChange whenever that folder changes, records a history
// entry only for moves the person makes, and jumps to a restored entry
// without recording one.
vi.mock('./views/BrowseView', () => {
  function BrowseStub({ browseRestore, onBrowseRestoreConsumed, onHistoryPush, onLocationChange, connectionId }) {
    const root = `/root/${connectionId}`
    const [path, setPath] = useState(root)
    const pushedInitial = useRef(false)
    useEffect(() => {
      if (pushedInitial.current) return
      pushedInitial.current = true
      onHistoryPush?.({ kind: 'browse', path: root, quickLookFile: null, connectionId })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-once push, guarded by the ref
    useEffect(() => {
      onLocationChange?.({ connectionId, path })
    }, [path]) // eslint-disable-line react-hooks/exhaustive-deps -- reports each folder once
    useEffect(() => {
      if (!browseRestore) return
      setPath(browseRestore.path)
      onBrowseRestoreConsumed?.()
    }, [browseRestore]) // eslint-disable-line react-hooks/exhaustive-deps -- consumes each restore once
    function walkInto(folder) {
      const next = `${path}/${folder}`
      setPath(next)
      onHistoryPush?.({ kind: 'browse', path: next, quickLookFile: null, connectionId })
    }
    return (
      <div data-testid="browse-view">
        <button data-testid="open-photos" onClick={() => walkInto('photos')}>photos</button>
        <button data-testid="open-2024" onClick={() => walkInto('2024')}>2024</button>
      </div>
    )
  }
  return { default: BrowseStub }
})

vi.mock('./views/SizeView',        () => ({ default: () => <div /> }))
vi.mock('./views/BackupView',      () => ({ default: () => <div /> }))
vi.mock('./views/ConnectionsView', () => ({ default: () => <div data-testid="connections-view" /> }))
vi.mock('./views/ConnectionView',  () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView',   () => ({ default: () => <div /> }))
vi.mock('./views/QueueView',       () => ({ default: () => <div /> }))
vi.mock('./views/LogView',         () => ({ default: () => <div /> }))
vi.mock('./views/SettingsView',    () => ({ default: () => <div /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/PlayOverlay', () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

const noopSubscribe = () => () => {}

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/root/c1' } },
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

async function clickNav(name) {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', { name }))
  await act(async () => {})
}

async function openBrowse() {
  render(<App />)
  await act(async () => {})
  await clickNav('Connections')
  await waitFor(() => expect(screen.getByTestId('connections-view')).toBeTruthy())
  await clickNav('Browse')
}

function tabName() {
  return document.querySelector('[data-tabid]').textContent
}

async function click(testId) {
  fireEvent.click(screen.getByTestId(testId))
  await act(async () => {})
}

async function mouseSide(button) {
  fireEvent.mouseDown(window, { button })
  await act(async () => {})
}

describe('browse tab name', () => {
  it('follows the folder when walking in', async () => {
    await openBrowse()
    expect(tabName()).toContain('Atlas')
    await click('open-photos')
    expect(tabName()).toContain('photos')
  })

  it('follows the folder when going back and forward', async () => {
    await openBrowse()
    await click('open-photos')
    await click('open-2024')
    expect(tabName()).toContain('2024')

    await mouseSide(3)
    expect(tabName()).toContain('photos')
    expect(tabName()).not.toContain('2024')

    await mouseSide(3)
    expect(tabName()).toContain('Atlas')

    await mouseSide(4)
    expect(tabName()).toContain('photos')
  })
})
