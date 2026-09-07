import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the remote browser on the redesign, after
// ref/remote-browser.png and ref/remote-browser-list.png: one toolbar row
// (history, connection picker, breadcrumbs, favorites, sync root, filter,
// sort, Select, new folder, activity, view toggle), the grid or the list,
// the bulk bar while something is selected, and a footer with the count,
// the drop hint and the checkout link. Every behavior in BrowseView.test.jsx
// and BrowseView.typeAhead.test.jsx stays.
//
// DOM contract:
//   - <div role="toolbar" aria-label="Browser"> holding buttons named
//     "Back", "Forward", the connection picker (named "Connection: <name>"),
//     "Favorites", "Jump to sync root", "Sort order",
//     "New folder", "Activity", "Grid view", "List view"; the active view
//     toggle has aria-pressed="true"
//   - the filter input keeps the placeholder "Search this folder"
//   - "Favorites" opens a menu (role="menu") listing the favorites by name
//     plus "Add current folder" / "Remove current folder"
//   - there is no "Select" mode toggle: checking an entry is what starts a
//     selection, and the bulk bar appears for as long as something is
//     selected. The toggle only duplicated what the checkboxes already do
//     and cost the breadcrumb trail the width it needs.
//   - the footer <footer> shows "<n> folders · <m> files", the text "Drop
//     files from Explorer or paste an image / URL to upload here", and a
//     "Check out to local mirror" control
//   - list view keeps the column headers Name / Size / Modified

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
  { id: 'conn-2', name: 'Vault', type: 'sftp', localFolder: 'C:\\docs', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/docs' } },
]

const ENTRIES = [
  { name: 'Documents', type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'Photos',    type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024,    modified: Date.now() },
  { name: 'video.mp4', type: 'file', size: 52428800, modified: Date.now() },
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
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" favorites={['/mnt/user/data/Photos']} onToggleFavorite={vi.fn()} onNavigateFavorite={vi.fn()} {...props} />)
  await screen.findByText('readme.txt')
  await act(async () => {})
}

function toolbar() {
  return screen.getByRole('toolbar', { name: 'Browser' })
}

function tool(name) {
  return within(toolbar()).getByRole('button', { name })
}

describe('BrowseView redesign', () => {
  it('renders the toolbar with every control in prototype order', async () => {
    await mount()
    const names = within(toolbar()).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent.trim())
    for (const expected of ['Back', 'Forward', 'Connection: Atlas', 'Favorites', 'Jump to sync root', 'Sort order', 'New folder', 'Activity', 'Grid view', 'List view']) {
      expect(names).toContain(expected)
    }
    expect(names).not.toContain('Select')
    expect(names.indexOf('Back')).toBeLessThan(names.indexOf('Favorites'))
    expect(names.indexOf('Favorites')).toBeLessThan(names.indexOf('Sort order'))
    expect(names.indexOf('Sort order')).toBeLessThan(names.indexOf('Grid view'))
    expect(within(toolbar()).getByPlaceholderText('Search this folder')).toBeTruthy()
  })

  it('marks the active view toggle', async () => {
    await mount()
    expect(tool('List view').getAttribute('aria-pressed')).toBe('true')
    expect(tool('Grid view').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(tool('Grid view'))
    expect(tool('Grid view').getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the favorites menu with the saved folders and the pin action', async () => {
    const onNavigateFavorite = vi.fn()
    await mount({ onNavigateFavorite })
    fireEvent.click(tool('Favorites'))
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Photos/ }))
    expect(onNavigateFavorite).toHaveBeenCalledWith('conn-1', '/mnt/user/data/Photos')
    fireEvent.click(tool('Favorites'))
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: /current folder/i })).toBeTruthy()
  })

  it('offers no selection-mode toggle', async () => {
    await mount()
    expect(within(toolbar()).queryByRole('button', { name: 'Select' })).toBeNull()
  })

  it('raises and drops the bulk bar as entries are checked and unchecked', async () => {
    const user = userEvent.setup()
    await mount()
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()

    const row = screen.getByText('readme.txt').closest('.row')
    await user.click(row.querySelector('.checkbox'))
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy()

    await user.click(row.querySelector('.checkbox'))
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
  })

  it('shows the count, the drop hint and the checkout link in the footer', async () => {
    await mount()
    const footer = screen.getByRole('contentinfo')
    expect(footer.textContent).toContain('2 folders · 2 files')
    expect(footer.textContent).toContain('Drop files from Explorer or paste an image / URL to upload here')
    expect(within(footer).getByRole('button', { name: 'Check out to local mirror' })).toBeTruthy()
  })

  it('keeps the list column headers', async () => {
    await mount()
    expect(screen.getByText('Name')).toBeTruthy()
    expect(screen.getByText('Size')).toBeTruthy()
    expect(screen.getByText('Modified')).toBeTruthy()
  })
})
