import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import StatusBar from './StatusBar'
import { createWinraidMock } from '../../__mocks__/winraid'

// Contract under test — the 30px bottom bar of the shell: a status dot and
// one line of text on the left (watchers, then transfers), and on the right
// an update pill when a downloaded update is waiting, then the version.
//
// DOM contract:
//   - <footer role="status"> (the whole bar is the live region)
//   - a status dot element with data-status="stopped" | "watching" | "busy"
//     (busy while a transfer is in flight or a watcher is enqueueing)
//   - the text keeps today's wording: "All scanners stopped",
//     "Scanning for changes", "<n> scanners active", "Detecting · <file>",
//     and appends " · <transfer label>" while the queue has work
//     ("Transferring", "<n> transferring", "<done>/<total> transferring",
//     with " · <connection names>" when known)
//   - clicking the transfer text calls onNavigate('queue')
//   - the version reads "v<version>" from window.winraid.getVersion()
//   - window.winraid.update.onStatus({ status: 'ready', version }) shows a
//     button "Update <version> ready — see what's new" that calls
//     window.winraid.whatsNew.open(); any other status hides it

let updateListener = null

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas' },
  { id: 'c2', name: 'Vault' },
]

function setup() {
  updateListener = null
  window.winraid = createWinraidMock({
    update: { onStatus: vi.fn((listener) => { updateListener = listener; return () => {} }) },
  })
  window.winraid.getVersion = vi.fn().mockResolvedValue('2.8.0')
  window.winraid.whatsNew = { open: vi.fn().mockResolvedValue(undefined), close: vi.fn() }
}

const defaultProps = {
  watcherStatus:   {},
  activeTransfers: new Map(),
  queueDepth:      0,
  batchTotal:      0,
  batchConnections: new Set(),
  currentFileProgress: 0,
  connections:     CONNECTIONS,
  onNavigate:      vi.fn(),
}

async function mount(props = {}) {
  render(<StatusBar {...defaultProps} {...props} />)
  await act(async () => {})
}

function bar() {
  return screen.getByRole('status')
}

function dot() {
  return bar().querySelector('[data-status]')
}

beforeEach(setup)
afterEach(() => { delete window.winraid })

describe('StatusBar', () => {
  it('reports stopped scanners with a stopped dot', async () => {
    await mount()
    expect(bar().textContent).toContain('All scanners stopped')
    expect(dot().getAttribute('data-status')).toBe('stopped')
  })

  it('reports one watcher as scanning and several as a count', async () => {
    await mount({ watcherStatus: { c1: { watching: true, state: 'idle' } } })
    expect(bar().textContent).toContain('Scanning for changes')
    expect(dot().getAttribute('data-status')).toBe('watching')
  })

  it('counts several active scanners', async () => {
    await mount({ watcherStatus: { c1: { watching: true, state: 'idle' }, c2: { watching: true, state: 'idle' } } })
    expect(bar().textContent).toContain('2 scanners active')
  })

  it('shows the file being detected and goes busy', async () => {
    await mount({ watcherStatus: { c1: { watching: true, state: 'enqueueing', file: 'clip.mp4' } } })
    expect(bar().textContent).toContain('Detecting · clip.mp4')
    expect(dot().getAttribute('data-status')).toBe('busy')
  })

  it('appends the transfer label with the batch connections and navigates to the queue', async () => {
    const onNavigate = vi.fn()
    await mount({
      onNavigate,
      watcherStatus:    { c1: { watching: true, state: 'idle' } },
      activeTransfers:  new Map([['job1', 'c1']]),
      queueDepth:       3,
      batchTotal:       5,
      batchConnections: new Set(['c1']),
    })
    expect(bar().textContent).toContain('Scanning for changes · 3/5 transferring · Atlas')
    expect(dot().getAttribute('data-status')).toBe('busy')
    fireEvent.click(screen.getByText(/transferring/))
    expect(onNavigate).toHaveBeenCalledWith('queue')
  })

  it('uses the singular label for one transfer outside a batch', async () => {
    await mount({ activeTransfers: new Map([['job1', 'c2']]), queueDepth: 0, batchTotal: 1, batchConnections: new Set(['c2']) })
    expect(bar().textContent).toContain('Transferring · Vault')
  })

  it('shows the running version', async () => {
    await mount()
    expect(bar().textContent).toContain('v2.8.0')
  })

  it('shows the update pill only while an update is ready, and opens What\'s New from it', async () => {
    await mount()
    expect(screen.queryByRole('button', { name: /see what's new/ })).toBeNull()
    await act(async () => { updateListener({ status: 'ready', version: '2.9.0' }) })
    const pill = screen.getByRole('button', { name: 'Update 2.9.0 ready — see what\'s new' })
    fireEvent.click(pill)
    expect(window.winraid.whatsNew.open).toHaveBeenCalledTimes(1)
    await act(async () => { updateListener({ status: 'up-to-date' }) })
    expect(screen.queryByRole('button', { name: /see what's new/ })).toBeNull()
  })
})
