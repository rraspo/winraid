import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the Browse view must expose a transient bulk-action
// bar (the same pattern the Play wall already uses) so a multi-selection
// can be moved, deleted or cleared without resorting to a right-click. The
// command bar's Rename button keeps its single-entry gate; bulk renaming is
// explicitly out of scope, so the existing single-only behaviour is covered
// here as a non-regression case.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]
const CONN_ID = 'conn-1'

const ENTRIES = [
  { name: 'Documents',   type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'Photos',      type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'readme.txt',  type: 'file', size: 1024,     modified: Date.now() },
  { name: 'video.mp4',   type: 'file', size: 52428800, modified: Date.now() },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        if (key === 'activeConnectionId') return Promise.resolve(CONN_ID)
        return Promise.resolve({ connections: CONNECTIONS, activeConnectionId: CONN_ID })
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

async function mountList(props = {}) {
  render(<BrowseView onHistoryPush={() => {}} connectionId={CONN_ID} {...props} />)
  await screen.findByText('readme.txt')
}

function row(name) {
  // Multiple "name" matches can exist once a modal referencing the entry
  // is open. Scope to the row, never the modal that might be in front of it.
  const candidates = screen.getAllByText(name)
  return candidates.find((el) => el.closest('.row'))?.closest('.row')
}

function card(name) {
  const candidates = screen.getAllByText(name)
  return candidates.find((el) => el.closest('.gridCard'))?.closest('.gridCard')
}

function bulkBar() {
  return screen.queryByRole('toolbar', { name: 'Selection' })
}

async function clickBulkAction(user, name) {
  // Scope to the bulk bar so the command bar's own "Delete selected"
  // (which shares that accessible name) never wins the lookup.
  const bar = await screen.findByRole('toolbar', { name: 'Selection' })
  await user.click(within(bar).getByRole('button', { name }))
}

describe('BrowseView — bulk action bar', () => {
  it('is absent with nothing selected, appears at one entry, disappears when the selection is cleared', async () => {
    const user = userEvent.setup()
    await mountList()
    expect(bulkBar()).toBeNull()

    await user.click(row('Documents').querySelector('.checkbox'))
    expect(await screen.findByRole('toolbar', { name: 'Selection' })).toBeTruthy()

    // Deselecting the only selected entry collapses the selection to
    // empty, which must take the bar away again.
    await user.click(row('Documents').querySelector('.checkbox'))
    await waitFor(() => expect(bulkBar()).toBeNull())
  })

  it('reports the selection count', async () => {
    const user = userEvent.setup()
    await mountList()
    await user.click(row('Documents').querySelector('.checkbox'))
    await user.click(row('Photos').querySelector('.checkbox'))

    const bar = await screen.findByRole('toolbar', { name: 'Selection' })
    expect(bar.textContent).toMatch(/2\s+selected/)
  })

  it('Move selected opens the bulk destination picker', async () => {
    const user = userEvent.setup()
    await mountList()
    await user.click(row('Documents').querySelector('.checkbox'))
    await user.click(row('Photos').querySelector('.checkbox'))

    await clickBulkAction(user, 'Move selected')

    expect(await screen.findByRole('dialog', { name: 'Move 2 items' })).toBeTruthy()
  })

  it('Delete selected opens the bulk confirm', async () => {
    const user = userEvent.setup()
    await mountList()
    await user.click(row('Documents').querySelector('.checkbox'))
    await user.click(row('Photos').querySelector('.checkbox'))

    await clickBulkAction(user, 'Delete selected')

    expect(await screen.findByRole('dialog', { name: 'Delete 2 items?' })).toBeTruthy()
  })

  it('Clear selection empties the selection and removes the bar', async () => {
    const user = userEvent.setup()
    await mountList()
    await user.click(row('Documents').querySelector('.checkbox'))
    await user.click(row('Photos').querySelector('.checkbox'))
    expect(bulkBar()).toBeTruthy()

    await clickBulkAction(user, 'Clear selection')

    await waitFor(() => expect(bulkBar()).toBeNull())
    expect(row('Documents').querySelector('input[type="checkbox"]').checked).toBe(false)
    expect(row('Photos').querySelector('input[type="checkbox"]').checked).toBe(false)
  })

  it('replaces the count with "Deleting <i> of <n>" while a bulk delete is in flight', async () => {
    let resolveDelete
    window.winraid.remote.delete = vi.fn().mockImplementation(
      () => new Promise((r) => { resolveDelete = r })
    )

    const user = userEvent.setup()
    await mountList()
    await user.click(row('Documents').querySelector('.checkbox'))
    await user.click(row('Photos').querySelector('.checkbox'))

    await clickBulkAction(user, 'Delete selected')
    const dialog = screen.getByRole('dialog', { name: 'Delete 2 items?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 items' }))

    // The bar persists past the selection being cleared and adopts the
    // same wording the Play wall uses for its in-flight delete.
    const bar = await screen.findByRole('toolbar', { name: 'Selection' })
    expect(within(bar).getByText(/Deleting\s+\d+\s+of\s+2/)).toBeInTheDocument()

    // Cleanup so the hanging promise never leaks into the next test.
    await act(async () => { resolveDelete({ ok: true }) })
  })

  it('disables Move selected, Delete selected and Clear selection while a bulk mutation is in flight', async () => {
    let resolveDelete
    window.winraid.remote.delete = vi.fn().mockImplementation(
      () => new Promise((r) => { resolveDelete = r })
    )

    const user = userEvent.setup()
    await mountList()
    await user.click(row('Documents').querySelector('.checkbox'))
    await user.click(row('Photos').querySelector('.checkbox'))

    await clickBulkAction(user, 'Delete selected')
    const dialog = screen.getByRole('dialog', { name: 'Delete 2 items?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 items' }))

    const bar = await screen.findByRole('toolbar', { name: 'Selection' })
    expect(within(bar).getByRole('button', { name: 'Move selected' })).toBeDisabled()
    expect(within(bar).getByRole('button', { name: 'Delete selected' })).toBeDisabled()
    expect(within(bar).getByRole('button', { name: 'Clear selection' })).toBeDisabled()

    await act(async () => { resolveDelete({ ok: true }) })
  })

  it('also appears in grid view when entries are selected', async () => {
    const user = userEvent.setup()
    await mountList()

    // Switch to grid view via the View button's dropdown so the test does
    // not depend on storage-spy timing.
    await user.click(screen.getByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('menuitem', { name: 'Grid view' }))
    await screen.findByText('Documents')

    await user.click(card('Documents').querySelector('.gridCheckbox'))
    await user.click(card('Photos').querySelector('.gridCheckbox'))

    const bar = await screen.findByRole('toolbar', { name: 'Selection' })
    expect(bar.textContent).toMatch(/2\s+selected/)
  })

  it('Rename stays single-only — disabled at zero and two or more, enabled at exactly one', async () => {
    const user = userEvent.setup()
    await mountList()

    const rename = screen.getByRole('button', { name: 'Rename' })
    expect(rename).toBeDisabled()

    await user.click(row('Documents').querySelector('.checkbox'))
    expect(rename).toBeEnabled()

    await user.click(row('Photos').querySelector('.checkbox'))
    expect(rename).toBeDisabled()
  })
})
