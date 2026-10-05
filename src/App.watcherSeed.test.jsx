import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import App from './App'
import { createWinraidMock } from './__mocks__/winraid'

// Contract under test — a watcher that is running is never shown as stopped
// after a restart.
//
// On launch main starts the watchers and pushes the new state once. The
// renderer seeded itself from a single watcher.list() on mount and only
// learned anything later from that push. If the watchers came up after the
// seed was taken but before the renderer had subscribed, the push went
// nowhere and the seed was already stale: the connection was running and
// every screen called it Stopped until something else happened to push.
//
// What this suite asserts: whatever order the seed, the subscription and
// main's startup land in, the state the renderer ends up showing is the state
// main actually holds.

vi.mock('./views/DashboardView', () => ({
  default: ({ watcherStatus }) => (
    <div data-testid="dashboard-view">
      <span data-testid="c1-watching">{String(watcherStatus?.c1?.watching ?? false)}</span>
    </div>
  ),
}))
vi.mock('./views/ConnectionView', () => ({ default: () => <div /> }))
vi.mock('./components/EditorView', () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\present', sftp: { remotePath: '/root/c1' } },
]
const RUNNING = { c1: { watching: true, folder: 'C:\\present', state: 'watching', file: null } }

function setup({ watcher }) {
  const configStore = { connections: CONNECTIONS, activeConnectionId: 'c1', defaultConnection: null, favoritesByConnection: {} }
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
    watcher,
  })
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

afterEach(() => { delete window.winraid })

describe('the watcher state the renderer shows matches main after a restart', () => {
  it('shows a watcher running when main started it between the seed and the subscription, and the push was lost', async () => {
    // main's view of the world; list() answers with whatever it holds at the moment it is asked
    let mainState = {}
    const watcher = {
      list: vi.fn(() => Promise.resolve({ ...mainState })),
      // The startup sweep finishes right as the renderer subscribes, and its
      // single push was sent before the listener existed — so the callback
      // is never invoked.
      onStatus: vi.fn(() => {
        mainState = RUNNING
        return () => {}
      }),
    }
    setup({ watcher })

    render(<App />)
    await act(async () => {})

    await waitFor(() => expect(screen.getByTestId('c1-watching').textContent).toBe('true'))
  })

  it('asks main for the current state only after it is listening for pushes', async () => {
    const order = []
    const watcher = {
      list: vi.fn(() => { order.push('list'); return Promise.resolve({}) }),
      onStatus: vi.fn(() => { order.push('subscribe'); return () => {} }),
    }
    setup({ watcher })

    render(<App />)
    await act(async () => {})

    expect(order).toContain('subscribe')
    expect(order.lastIndexOf('list')).toBeGreaterThan(order.indexOf('subscribe'))
  })

  it('still takes pushes after seeding', async () => {
    let push
    const watcher = {
      list: vi.fn(() => Promise.resolve({})),
      onStatus: vi.fn((callback) => { push = callback; return () => {} }),
    }
    setup({ watcher })

    render(<App />)
    await act(async () => {})
    expect(screen.getByTestId('c1-watching').textContent).toBe('false')

    await act(async () => { push(RUNNING) })
    expect(screen.getByTestId('c1-watching').textContent).toBe('true')
  })

  it('does not let a late seed overwrite a newer push', async () => {
    let push
    let resolveList
    const watcher = {
      list: vi.fn(() => new Promise((resolve) => { resolveList = resolve })),
      onStatus: vi.fn((callback) => { push = callback; return () => {} }),
    }
    setup({ watcher })

    render(<App />)
    await act(async () => {})

    // The push lands first, then the slower list() answers with what it saw earlier.
    await act(async () => { push(RUNNING) })
    await act(async () => { resolveList({}) })

    expect(screen.getByTestId('c1-watching').textContent).toBe('true')
  })
})
