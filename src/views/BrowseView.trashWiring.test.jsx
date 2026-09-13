import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

// Contract under test — both of BrowseView's delete dialogs (the single-item
// one opened from a row's "..." menu, and the bulk one opened from the
// selection toolbar) tell the truth about where the file is going. That
// truth comes from the active connection's entry in `trashByConnection`, a
// prop passed down from Settings by way of App — not read independently by
// this view.

vi.mock('../components/PlayOverlay', () => ({ default: () => null }))

const CONNECTIONS = [
  {
    id: 'conn-1',
    name: 'Atlas',
    localFolder: 'C:\\sync',
    sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' },
  },
]

const ENTRIES = [
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
]

function setup() {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        if (key === 'activeConnectionId') return Promise.resolve('conn-1')
        return Promise.resolve({ connections: CONNECTIONS, activeConnectionId: 'conn-1' })
      }),
    },
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: ENTRIES }),
    },
  })
}

beforeEach(() => {
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

function entryRow() {
  return document.querySelector('[data-entry-path="/mnt/user/data/readme.txt"]')
}

function openEntryMenu() {
  fireEvent.click(within(entryRow()).getByRole('button'))
}

describe('BrowseView single delete', () => {
  it('tells the dialog the connection has a trash folder', async () => {
    setup()
    render(
      <BrowseView
        onHistoryPush={() => {}}
        trashByConnection={{ 'conn-1': { folder: '/mnt/user/media' } }}
      />
    )
    await screen.findByText('readme.txt')
    openEntryMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/trash/i)
    expect(dialog).not.toHaveTextContent(/permanently/i)
    expect(screen.getByRole('button', { name: /move to trash/i })).toBeInTheDocument()
  })

  it('assumes permanent when no folder is configured for this connection', async () => {
    setup()
    render(<BrowseView onHistoryPush={() => {}} trashByConnection={{}} />)
    await screen.findByText('readme.txt')
    openEntryMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog')).toHaveTextContent(/permanently/i)
  })
})

describe('BrowseView bulk delete', () => {
  it('tells the dialog the connection has a trash folder', async () => {
    setup()
    render(
      <BrowseView
        onHistoryPush={() => {}}
        trashByConnection={{ 'conn-1': { folder: '/mnt/user/media' } }}
      />
    )
    await screen.findByText('readme.txt')
    fireEvent.click(within(entryRow()).getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selection' })).getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/trash/i)
    expect(dialog).not.toHaveTextContent(/permanently/i)
  })

  it('assumes permanent when no folder is configured for this connection', async () => {
    setup()
    render(<BrowseView onHistoryPush={() => {}} trashByConnection={{}} />)
    await screen.findByText('readme.txt')
    fireEvent.click(within(entryRow()).getByRole('checkbox'))
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Selection' })).getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog')).toHaveTextContent(/permanently/i)
  })
})
