import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — favorites on the two-row toolbar. The toolbar no
// longer carries a standalone Favorites button with a cross-connection
// browsing dropdown (that capability has no toolbar home in this redesign);
// what survives is the add/remove toggle, relocated into the overflow
// ("...") menu as a single "Add to favourites" / "Remove from favourites"
// line, scoped to the open connection's current folder.
//
// DOM contract:
//   - the browser still takes `favoritesByConnection`, a map of connection
//     id to the paths saved under it (or the legacy single-connection
//     `favorites` array)
//   - the overflow menu's favourites line reads "Remove from favourites"
//     when the current folder is one of the open connection's saved
//     folders, "Add to favourites" otherwise
//   - choosing it calls onToggleFavorite(path) for the folder currently
//     open, under the open connection — never another one

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
  { id: 'conn-2', name: 'Vault', type: 'sftp', localFolder: 'C:\\docs', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/docs' } },
]

const ENTRIES = [
  { name: 'Documents', type: 'dir',  size: 0,    modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
]

const FAVORITES_BY_CONNECTION = {
  'conn-1': ['/mnt/user/data'],
  'conn-2': ['/mnt/user/docs/work/Invoices'],
}

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
  const onToggleFavorite = vi.fn()
  render(
    <BrowseView
      onHistoryPush={() => {}}
      connectionId="conn-1"
      favoritesByConnection={FAVORITES_BY_CONNECTION}
      onToggleFavorite={onToggleFavorite}
      {...props}
    />,
  )
  await screen.findByText('readme.txt')
  await act(async () => {})
  return { onToggleFavorite }
}

function openOverflow() {
  fireEvent.click(screen.getByRole('button', { name: 'More options' }))
  return screen.getByRole('menu')
}

describe('BrowseView favorites — overflow menu toggle', () => {
  it('reads "Remove from favourites" when the current folder is already saved', async () => {
    await mount()
    openOverflow()
    expect(screen.getByRole('menuitem', { name: 'Remove from favourites' })).toBeInTheDocument()
  })

  it('reads "Add to favourites" when the current folder is not saved', async () => {
    await mount({ favoritesByConnection: { 'conn-1': [] } })
    openOverflow()
    expect(screen.getByRole('menuitem', { name: 'Add to favourites' })).toBeInTheDocument()
  })

  it('toggles the current folder under the open connection, not another one', async () => {
    const { onToggleFavorite } = await mount()
    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from favourites' }))
    expect(onToggleFavorite).toHaveBeenCalledWith('/mnt/user/data')
  })

  it('closes the overflow menu after toggling', async () => {
    await mount()
    openOverflow()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from favourites' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('has no cross-connection favorites list in the toolbar', async () => {
    await mount()
    openOverflow()
    expect(screen.queryByText('Invoices')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull()
  })
})
