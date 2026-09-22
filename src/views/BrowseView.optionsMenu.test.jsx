import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the overflow menu's meta group wires Options to a
// popover anchored at the overflow button (not a modal, not a third menu),
// and its "All settings…" hands off to the existing Settings view rather
// than growing a second settings surface.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', folderMode: 'flat', localFolder: '', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

const ENTRIES = [
  { name: 'Documents', type: 'dir',  size: 0,     modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        if (key === 'activeConnectionId') return Promise.resolve('conn-1')
        return Promise.resolve({ connections: CONNECTIONS, activeConnectionId: 'conn-1' })
      }),
    },
    remote: { list: vi.fn().mockResolvedValue({ ok: true, entries: ENTRIES }) },
  })
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('list')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  remoteFS.clearAll()
  toast.clearAll()
  delete window.winraid
  vi.restoreAllMocks()
})

async function mount(props = {}) {
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" onToggleFavorite={vi.fn()} {...props} />)
  await screen.findByText('readme.txt')
  await act(async () => {})
}

function commandRow() {
  return screen.getByRole('toolbar', { name: 'Browser commands' })
}

describe('overflow menu — Options', () => {
  it('opens a popover, not a modal, anchored at the overflow button', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Options' }))
    expect(screen.getByRole('menu', { name: 'Browse options' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    // The overflow dropdown itself closed when Options opened.
    expect(screen.queryByRole('menuitem', { name: 'Jump to sync root' })).toBeNull()
  })

  it('navigates to Settings from All settings…', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    await mount({ onNavigate })
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'All settings…' }))
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })
})
