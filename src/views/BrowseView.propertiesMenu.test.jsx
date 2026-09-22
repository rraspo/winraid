import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the overflow menu's meta group wires Properties to
// its own modal (not a second dialog family), and the per-entry
// "..."/right-click menu reaches Properties too, independent of any
// multi-selection elsewhere in the view.

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

describe('overflow menu — Properties', () => {
  it('disables Properties with nothing selected', async () => {
    await mount()
    await userEvent.setup().click(within(commandRow()).getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('menuitem', { name: 'Properties' })).toBeDisabled()
  })

  it('opens the dialog for a single selection', async () => {
    const user = userEvent.setup()
    await mount()
    const rowEl = screen.getByText('readme.txt').closest('.row')
    await user.click(rowEl.querySelector('.checkbox'))
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Properties' }))
    expect(await screen.findByRole('dialog', { name: 'readme.txt Properties' })).toBeTruthy()
  })

  it('opens the multi-selection summary for a multi-selection', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select all' }))
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Properties' }))
    expect(await screen.findByRole('dialog', { name: '2 items — Properties' })).toBeTruthy()
  })
})

describe('per-entry menu — Properties', () => {
  it('opens Properties for just that row from the "..." menu, ignoring a broader selection', async () => {
    const user = userEvent.setup()
    await mount()
    // Select Documents, then open Properties from readme.txt's own row menu.
    const docsRow = screen.getByText('Documents').closest('.row')
    await user.click(docsRow.querySelector('.checkbox'))

    const readmeRow = screen.getByText('readme.txt').closest('.row')
    await user.click(within(readmeRow).getByRole('button', { name: '' }))
    fireEvent.click(await screen.findByText('Properties'))
    expect(await screen.findByRole('dialog', { name: 'readme.txt Properties' })).toBeTruthy()
  })
})
