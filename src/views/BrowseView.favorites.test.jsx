import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — favorites span every connection, as the design
// has them. Before this the browser was handed one connection's slice, so
// a folder starred under another connection could be saved and never
// reached again.
//
// DOM contract:
//   - the browser takes `favoritesByConnection`, a map of connection id to
//     the paths saved under it, in place of a single connection's array
//   - the Favorites menu lists every saved folder from every connection,
//     each entry showing the folder name and, under it, the name of the
//     connection it belongs to; the open connection's favorites come first
//   - choosing an entry calls onNavigateFavorite(connectionId, path) with
//     that entry's own connection, so picking one from another connection
//     lands on that connection and folder
//   - the star still adds or removes the current folder under the open
//     connection, and reads as saved when the current folder is one of the
//     open connection's favorites

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
  { id: 'conn-2', name: 'Vault', type: 'sftp', localFolder: 'C:\\docs', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/docs' } },
]

const ENTRIES = [
  { name: 'Documents', type: 'dir',  size: 0,    modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
]

const FAVORITES_BY_CONNECTION = {
  'conn-1': ['/mnt/user/data/Photos'],
  'conn-2': ['/mnt/user/docs/work/Invoices', '/mnt/user/docs/Contracts'],
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
  const onNavigateFavorite = vi.fn()
  const onToggleFavorite   = vi.fn()
  render(
    <BrowseView
      onHistoryPush={() => {}}
      connectionId="conn-1"
      favoritesByConnection={FAVORITES_BY_CONNECTION}
      onToggleFavorite={onToggleFavorite}
      onNavigateFavorite={onNavigateFavorite}
      {...props}
    />,
  )
  await screen.findByText('readme.txt')
  await act(async () => {})
  return { onNavigateFavorite, onToggleFavorite }
}

function openFavorites() {
  fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
  return screen.getByRole('menu')
}

describe('BrowseView favorites across connections', () => {
  it('lists every connection\'s favorites, the open connection first, each named with its connection', async () => {
    await mount()
    const items = within(openFavorites()).getAllByRole('menuitem')
      .map((item) => item.textContent.replace(/\s+/g, ' ').trim())
      .filter((text) => !/current folder/i.test(text))
    expect(items).toEqual([
      'Photos Atlas',
      'Invoices Vault',
      'Contracts Vault',
    ])
  })

  it('jumps to a favorite of another connection with that connection', async () => {
    const { onNavigateFavorite } = await mount()
    fireEvent.click(within(openFavorites()).getByRole('menuitem', { name: /Invoices/ }))
    expect(onNavigateFavorite).toHaveBeenCalledWith('conn-2', '/mnt/user/docs/work/Invoices')
  })

  it('jumps to a favorite of the open connection with its own id', async () => {
    const { onNavigateFavorite } = await mount()
    fireEvent.click(within(openFavorites()).getByRole('menuitem', { name: /Photos/ }))
    expect(onNavigateFavorite).toHaveBeenCalledWith('conn-1', '/mnt/user/data/Photos')
  })

  it('still adds the current folder under the open connection', async () => {
    const { onToggleFavorite } = await mount()
    fireEvent.click(within(openFavorites()).getByRole('menuitem', { name: /Add current folder/i }))
    expect(onToggleFavorite).toHaveBeenCalledWith('/mnt/user/data')
  })

  it('says so when nothing is saved anywhere', async () => {
    await mount({ favoritesByConnection: {} })
    expect(within(openFavorites()).getByText('No favorites yet')).toBeTruthy()
  })
})
