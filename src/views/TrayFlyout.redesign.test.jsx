import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import TrayFlyout from './TrayFlyout'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the tray flyout on the redesign, after
// ref/tray-flyout.png: a small frameless window opened from the tray icon
// (and from the nav rail's Tray item) that replaces the tray context menu.
// It renders the same bundle with the #tray hash, like What's New does.
//
// DOM contract:
//   - a header with the app icon, "WinRaid" and "v<version>"
//   - a toggle row: "Pause syncing" while any watcher is running or the
//     queue is active, calling watcher.pauseAll(); "Resume syncing"
//     otherwise, calling watcher.resumeAll()
//   - one row per connection, <li aria-label="<name>">, with the watcher
//     dot, the name and "<n> today" (DONE jobs created today for that
//     connection)
//   - a footer with "Open WinRaid" calling tray.showMain() and "Quit"
//     calling tray.quit()

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { remotePath: '/mnt/user/docs' } },
]

const TODAY = Date.now()

function setup({ watching = true } = {}) {
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockImplementation((key) => Promise.resolve(key === 'connections' ? CONNECTIONS : { connections: CONNECTIONS })) },
    watcher: {
      list: vi.fn().mockResolvedValue({ c1: { watching, state: 'idle' }, c2: { watching: false, state: 'idle' } }),
    },
    queue: {
      list: vi.fn().mockResolvedValue([
        { id: 'j1', status: 'DONE', connectionId: 'c1', createdAt: TODAY, filename: 'a.jpg' },
        { id: 'j2', status: 'DONE', connectionId: 'c1', createdAt: TODAY, filename: 'b.jpg' },
        { id: 'j3', status: 'DONE', connectionId: 'c2', createdAt: TODAY - 3 * 86_400_000, filename: 'old.jpg' },
      ]),
    },
  })
  window.winraid.getVersion = vi.fn().mockResolvedValue('3.0.0')
  window.winraid.tray = { showMain: vi.fn().mockResolvedValue(undefined), quit: vi.fn().mockResolvedValue(undefined) }
}

async function mount(options) {
  setup(options)
  render(<TrayFlyout />)
  await act(async () => {})
}

afterEach(() => { delete window.winraid })
beforeEach(() => {})

describe('TrayFlyout redesign', () => {
  it('shows the app name and version', async () => {
    await mount()
    expect(screen.getByText('WinRaid')).toBeTruthy()
    expect(screen.getByText('v3.0.0')).toBeTruthy()
  })

  it('offers to pause syncing while a watcher runs, and pauses everything', async () => {
    await mount({ watching: true })
    fireEvent.click(screen.getByRole('button', { name: 'Pause syncing' }))
    expect(window.winraid.watcher.pauseAll).toHaveBeenCalledTimes(1)
  })

  it('offers to resume syncing when nothing runs', async () => {
    await mount({ watching: false })
    fireEvent.click(screen.getByRole('button', { name: 'Resume syncing' }))
    expect(window.winraid.watcher.resumeAll).toHaveBeenCalledTimes(1)
  })

  it('lists each connection with its files today', async () => {
    await mount()
    expect(within(screen.getByRole('listitem', { name: 'Atlas' })).getByText('2 today')).toBeTruthy()
    expect(within(screen.getByRole('listitem', { name: 'Vault' })).getByText('0 today')).toBeTruthy()
  })

  it('opens the main window and quits from the footer', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open WinRaid' }))
    expect(window.winraid.tray.showMain).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
    expect(window.winraid.tray.quit).toHaveBeenCalledTimes(1)
  })
})
