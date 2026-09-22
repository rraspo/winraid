import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the remote browser's toolbar on the Windows-11-
// Explorer-style redesign: two 40px rows instead of one 48px row.
//
// Row 1 (navigation): Back, Forward, Up one level, Refresh, the connection
// picker, the breadcrumb trail, a flex spacer, then Search. Forward is a
// restoration of the per-tab back/forward stack the parent (App.jsx) owns;
// Up one level derives the parent of the current directory and is disabled
// at the filesystem root. See BrowseView.navigation.test.jsx for the
// dedicated coverage of both.
//
// Row 2 (commands): "New Folder" (icon + words), a pipe, the icon-only
// file-management cluster (Cut/Copy/Paste/Rename/Delete), a pipe, "Sort"
// and "View" (icon + word + chevron each), a pipe, then the overflow ("...")
// button — inline right after its pipe, no spacer pushing it to the edge.
// Cut/Copy/Paste stay permanently disabled placeholders (no clipboard
// capability exists yet); Rename enables at exactly one selection; Delete
// and Cut/Copy/Paste-independent-of-selection Paste follow the card's
// enablement rules. Sort and View are relocations of the old sort dropdown
// and the old grid/list segmented pair (View now reports and lets you
// change the mode from one button).
//
// The below-toolbar selection bar is gone entirely: the bulk actions it
// held (Delete, Rename) now live in row 2's file-management cluster, and
// its Download/Move buttons are cut (Download survives via the row's own
// "..." menu; Move has no replacement yet).
//
// The overflow ("...") menu groups four sections behind divider rules
// (reusing EntryMenu's own `.menuDivider` styling): jump/play, favorites,
// selection, and a meta group (Properties so far; Options lands separately).
// The selection group wires all three of its items — Select all, Select
// none, Invert selection — alongside Jump to sync root, Play slideshow and
// Add/Remove favourite. See useSelection.test.js and
// BrowseView.selectionMenu.test.jsx for Select none/Invert's own behavior;
// PropertiesModal.test.jsx covers the meta group's own dialog.

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
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" favoritesByConnection={{ 'conn-1': ['/mnt/user/data/Photos'] }} onToggleFavorite={vi.fn()} {...props} />)
  await screen.findByText('readme.txt')
  await act(async () => {})
}

function navRow() {
  return screen.getByRole('toolbar', { name: 'Browser navigation' })
}

function commandRow() {
  return screen.getByRole('toolbar', { name: 'Browser commands' })
}

describe('BrowseView redesign — two-row toolbar', () => {
  it('lays out row 1 with Back, Forward and Up one level wired for navigation', async () => {
    await mount()
    const row = navRow()
    const names = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())

    for (const expected of ['Back', 'Forward', 'Up one level', 'Refresh', 'Connection: Atlas']) {
      expect(names).toContain(expected)
    }
    expect(names.indexOf('Back')).toBeLessThan(names.indexOf('Forward'))
    expect(names.indexOf('Forward')).toBeLessThan(names.indexOf('Up one level'))
    expect(names.indexOf('Up one level')).toBeLessThan(names.indexOf('Refresh'))
    expect(names.indexOf('Refresh')).toBeLessThan(names.indexOf('Connection: Atlas'))

    // This standalone mount wires no onForward/canGoForward (that's the
    // parent's job — see BrowseView.navigation.test.jsx), so Forward stays
    // disabled here the same way Back does with no onBack/canGoBack.
    expect(within(row).getByRole('button', { name: 'Forward' })).toBeDisabled()
    // Up is live at the mounted (non-root) path.
    expect(within(row).getByRole('button', { name: 'Up one level' })).toBeEnabled()

    expect(within(row).queryByTestId('toolbar-slot-forward')).toBeNull()
    expect(within(row).queryByTestId('toolbar-slot-up')).toBeNull()

    expect(within(row).getByPlaceholderText('Search this folder')).toBeTruthy()
  })

  it('lays out row 2 with New Folder, the file-management cluster, Sort, View and overflow, in order', async () => {
    await mount()
    const row = commandRow()
    const names = within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())

    expect(names).toEqual([
      'New Folder', 'Cut', 'Copy', 'Paste', 'Rename', 'Delete selected',
      'Sort order', 'View', 'More options',
    ])
  })

  it('draws exactly three pipe separators on row 2, none on row 1', async () => {
    await mount()
    expect(within(navRow()).queryAllByTestId('toolbar-pipe')).toHaveLength(0)
    expect(within(commandRow()).getAllByTestId('toolbar-pipe')).toHaveLength(3)
  })

  it('keeps Cut, Copy and Paste permanently disabled placeholders', async () => {
    await mount()
    const row = commandRow()
    expect(within(row).getByRole('button', { name: 'Cut' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Copy' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Paste' })).toBeDisabled()

    const rowEl = screen.getByText('readme.txt').closest('.row')
    await userEvent.setup().click(rowEl.querySelector('.checkbox'))
    expect(within(row).getByRole('button', { name: 'Cut' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Copy' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Paste' })).toBeDisabled()
  })

  it('enables Rename only at exactly one selection, Delete at one or more', async () => {
    const user = userEvent.setup()
    await mount()
    const row = commandRow()
    expect(within(row).getByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Delete selected' })).toBeDisabled()

    const rows = document.querySelectorAll('.row')
    await user.click(rows[0].querySelector('.checkbox'))
    expect(within(row).getByRole('button', { name: 'Rename' })).toBeEnabled()
    expect(within(row).getByRole('button', { name: 'Delete selected' })).toBeEnabled()

    await user.click(rows[1].querySelector('.checkbox'))
    expect(within(row).getByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Delete selected' })).toBeEnabled()
  })

  it('removes the selection bar entirely — no "Selection" toolbar appears while entries are checked', async () => {
    const user = userEvent.setup()
    await mount()
    const rowEl = screen.getByText('readme.txt').closest('.row')
    await user.click(rowEl.querySelector('.checkbox'))
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
    await user.click(rowEl.querySelector('.checkbox'))
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
  })

  it('relocates Sort as icon + word + chevron, unchanged options', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'Sort order' }))
    const menu = screen.getByText('Name Z-A')
    fireEvent.click(menu)
    expect(within(commandRow()).getByRole('button', { name: 'Sort order' }).textContent).toContain('Name Z-A')
  })

  it('reports and switches view mode through the single View button', async () => {
    const user = userEvent.setup()
    await mount()
    const viewBtn = within(commandRow()).getByRole('button', { name: 'View' })
    expect(viewBtn.querySelector('svg')).toBeTruthy()

    await user.click(viewBtn)
    await user.click(screen.getByRole('menuitem', { name: 'Grid view' }))
    await screen.findByText('readme.txt')
    // Switching back confirms the button still drives both directions.
    await user.click(within(commandRow()).getByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('menuitem', { name: 'List view' }))
    await screen.findByText('Name')
  })

  it('opens the overflow menu with four groups behind dividers, the selection group fully wired', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent.trim())

    expect(items).toEqual([
      'Jump to sync root', 'Play slideshow', 'Add to favourites',
      'Select all', 'Select none', 'Invert selection',
      'Properties',
    ])
    expect(within(menu).getByTestId('overflow-group-properties')).toBeTruthy()
  })

  it('overflow "Add to favourites" toggles the current folder and reads its state back', async () => {
    const user = userEvent.setup()
    const onToggleFavorite = vi.fn()
    await mount({ onToggleFavorite, favoritesByConnection: { 'conn-1': ['/mnt/user/data'] } })
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from favourites' }))
    expect(onToggleFavorite).toHaveBeenCalledWith('/mnt/user/data')
  })

  it('overflow "Select all" selects every entry in the current folder', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select all' }))
    expect(within(commandRow()).getByRole('button', { name: 'Delete selected' })).toBeEnabled()
  })

  it('overflow "Select none" clears the current selection, the same as Escape', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select all' }))
    expect(within(commandRow()).getByRole('button', { name: 'Delete selected' })).toBeEnabled()

    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select none' }))
    expect(within(commandRow()).getByRole('button', { name: 'Delete selected' })).toBeDisabled()
  })

  it('overflow "Invert selection" complements the selection against every entry in the current folder', async () => {
    const user = userEvent.setup()
    await mount()
    const rowEl = screen.getByText('readme.txt').closest('.row')
    await user.click(rowEl.querySelector('.checkbox'))
    expect(within(commandRow()).getByRole('button', { name: 'Rename' })).toBeEnabled()

    await user.click(within(commandRow()).getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Invert selection' }))
    // readme.txt was the only selection; inverting over all four fixture
    // entries leaves the other three selected.
    expect(within(commandRow()).getByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(within(commandRow()).getByRole('button', { name: 'Delete selected' })).toBeEnabled()
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
