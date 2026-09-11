import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import TrayFlyout from './TrayFlyout'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the flyout's icon buttons say what they do.
//
// Each connection row carries two icon-only buttons, a folder and an open
// folder, sitting side by side. They read identically at a glance and one
// goes to the NAS while the other opens a folder on this PC, which is not a
// difference you want to discover by guessing. They named themselves to a
// screen reader and to nobody else.
//
// Hovering either one now explains it, using the same tooltip the rest of
// the app uses, which portals out and so is not clipped by the flyout's
// small window.

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\Users\\user\\Pictures\\Import', sftp: { remotePath: '/mnt/user/media' } },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        return Promise.resolve({ connections: CONNECTIONS })
      }),
    },
    watcher: { list: vi.fn().mockResolvedValue({ c1: { watching: true, state: 'idle' } }) },
    queue:   { list: vi.fn().mockResolvedValue([]) },
  })
  window.winraid.getVersion = vi.fn().mockResolvedValue('3.0.0')
  window.winraid.local = { reveal: vi.fn(), exists: vi.fn(), clearFolder: vi.fn() }
  window.winraid.tray = {
    showMain: vi.fn(), quit: vi.fn(), openConnection: vi.fn(), onOpened: vi.fn(() => () => {}),
  }
})

afterEach(() => { delete window.winraid })

async function mount() {
  render(<TrayFlyout />)
  await act(async () => {})
}

function hover(label) {
  const button = screen.getByRole('button', { name: label })
  // The tooltip listens on the wrapper it puts around its child.
  fireEvent.mouseEnter(button.closest('span'))
}

describe('tray flyout tooltips', () => {
  it('explains the button that opens the connection in the app', async () => {
    await mount()
    hover('Browse Atlas')
    expect(screen.getByText('Browse this connection in WinRaid')).toBeTruthy()
  })

  it('explains the button that opens the folder on this PC', async () => {
    await mount()
    hover('Open Atlas folder')
    expect(screen.getByText('Open this connection’s watch folder on this PC')).toBeTruthy()
  })

  it('tells the two apart', async () => {
    await mount()
    const row = screen.getByRole('listitem', { name: 'Atlas' })
    const labels = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Browse Atlas', 'Open Atlas folder'])
  })
})
