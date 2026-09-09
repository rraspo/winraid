import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import TrayFlyout from './TrayFlyout'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the tray flyout is a shortcut panel, not just a
// status readout. Each connection row can take you straight into that
// connection's remote folder or open its watch folder on this PC, without
// going through the main window first. Reopening the flyout must not blank
// what is already on screen.
//
// DOM contract, per connection row:
//   - a button "Browse <name>" calling tray.openConnection(connectionId),
//     which raises the main window on that connection's browse tab
//   - a button "Open <name> folder" calling local.reveal(<watch folder>),
//     shown only when the connection has a watch folder configured
//   - reopening (tray.onOpened) refreshes in place: the rows already shown
//     stay on screen while the new data is on its way

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\Users\\user\\Pictures\\Import', sftp: { remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', type: 'sftp', localFolder: '', sftp: { remotePath: '/mnt/user/docs' } },
]

let openedCallback

function setup() {
  openedCallback = null
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        return Promise.resolve({ connections: CONNECTIONS })
      }),
    },
    watcher: { list: vi.fn().mockResolvedValue({ c1: { watching: true, state: 'idle' }, c2: { watching: false, state: 'idle' } }) },
    queue:   { list: vi.fn().mockResolvedValue([]) },
  })
  window.winraid.getVersion = vi.fn().mockResolvedValue('3.0.0')
  window.winraid.local = { reveal: vi.fn().mockResolvedValue({ ok: true }), exists: vi.fn().mockResolvedValue(true), clearFolder: vi.fn() }
  window.winraid.tray = {
    showMain: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    openConnection: vi.fn().mockResolvedValue(undefined),
    onOpened: vi.fn((callback) => { openedCallback = callback; return () => {} }),
  }
}

async function mount() {
  render(<TrayFlyout />)
  await act(async () => {})
}

function row(name) {
  return screen.getByRole('listitem', { name })
}

beforeEach(() => setup())
afterEach(() => { delete window.winraid })

describe('TrayFlyout shortcuts', () => {
  it('opens the remote folder of a connection in the main window', async () => {
    await mount()
    fireEvent.click(within(row('Atlas')).getByRole('button', { name: 'Browse Atlas' }))
    expect(window.winraid.tray.openConnection).toHaveBeenCalledWith('c1')
  })

  it('opens the watch folder of a connection on this PC', async () => {
    await mount()
    fireEvent.click(within(row('Atlas')).getByRole('button', { name: 'Open Atlas folder' }))
    expect(window.winraid.local.reveal).toHaveBeenCalledWith('C:\\Users\\user\\Pictures\\Import')
  })

  it('offers no folder shortcut when a connection has no watch folder', async () => {
    await mount()
    expect(within(row('Vault')).queryByRole('button', { name: 'Open Vault folder' })).toBeNull()
    expect(within(row('Vault')).getByRole('button', { name: 'Browse Vault' })).toBeTruthy()
  })

  it('keeps the rows on screen while a reopen refreshes them', async () => {
    await mount()
    expect(row('Atlas')).toBeTruthy()
    expect(openedCallback).toBeTypeOf('function')

    // Reopened, with every read slow to answer this time.
    let releaseReads
    const pending = new Promise((resolve) => { releaseReads = resolve })
    window.winraid.config.get = vi.fn(() => pending.then(() => CONNECTIONS))
    window.winraid.watcher.list = vi.fn(() => pending.then(() => ({})))
    window.winraid.queue.list = vi.fn(() => pending.then(() => []))
    await act(async () => { openedCallback() })

    // Still showing what it had, rather than emptying and refilling.
    expect(screen.getByRole('listitem', { name: 'Atlas' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Vault' })).toBeTruthy()

    await act(async () => { releaseReads() })
    expect(screen.getByRole('listitem', { name: 'Atlas' })).toBeTruthy()
  })
})
