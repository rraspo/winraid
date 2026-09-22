import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the per-entry right-click menu respects the
// current selection:
//   - right-click on an entry IN the selection acts on the WHOLE selection
//   - right-click on an entry NOT in the selection first resets the
//     selection to that entry, then acts on it
//   - right-click with no selection acts on the clicked entry
//   - right-click with one item selected acts on that one item
//
// The "..." dot button on a row is a separate opener and always acts on
// just that row — its contract lives in BrowseView.propertiesMenu.test.jsx
// and is intentionally untouched here.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]
const CONN_ID = 'conn-1'

const ENTRIES = [
  { name: 'Documents',  type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'Photos',     type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024,     modified: Date.now() },
]

const DOWNLOAD_PATH = 'C:\\Users\\test\\Downloads'

beforeEach(() => {
  // createWinraidMock only spreads nested overrides (config/remote/etc.);
  // top-level IPC like selectDownloadPath is added on the returned object.
  // The mock has no remote.download, so the Download test's override adds
  // it here. The right-click → Download flow needs both mocks so
  // handleDownload proceeds past its localPath early-return and records
  // each call.
  window.winraid = {
    ...createWinraidMock({
      config: {
        get: vi.fn().mockImplementation((key) => {
          if (key === 'connections') return Promise.resolve(CONNECTIONS)
          if (key === 'activeConnectionId') return Promise.resolve(CONN_ID)
          return Promise.resolve({ connections: CONNECTIONS, activeConnectionId: CONN_ID })
        }),
      },
      remote: {
        list: vi.fn().mockResolvedValue({ ok: true, entries: ENTRIES }),
        download: vi.fn().mockResolvedValue({ ok: true, count: 1 }),
      },
    }),
    selectDownloadPath: vi.fn().mockResolvedValue(DOWNLOAD_PATH),
  }
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

async function mountGrid(props = {}) {
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('grid')
  render(<BrowseView onHistoryPush={() => {}} connectionId={CONN_ID} {...props} />)
  await screen.findByText('readme.txt')
}

function row(name) {
  // Multiple "name" matches can exist once a modal referencing the entry
  // is open (e.g. MoveModal's subtitle). Scope to the row, never the
  // modal that might be in front of it.
  const candidates = screen.getAllByText(name)
  return candidates.find((el) => el.closest('.row'))?.closest('.row')
}
function card(name) {
  const candidates = screen.getAllByText(name)
  return candidates.find((el) => el.closest('.gridCard'))?.closest('.gridCard')
}
function rowInput(name) {
  return row(name).querySelector('input[type="checkbox"]')
}

async function selectByCheckbox(user, ...names) {
  for (const n of names) {
    const r = row(n)
    if (r) await user.click(r.querySelector('.checkbox'))
    else await user.click(card(n).querySelector('.gridCheckbox'))
  }
}

async function rightClickOn(user, name) {
  const el = row(name) ?? card(name)
  fireEvent.contextMenu(el, { clientX: 20, clientY: 20 })
  await screen.findByText('Move / Rename')
}

// ── List view ────────────────────────────────────────────────────────────

describe('Right-click on the list view — respects the current selection', () => {
  it('Delete inside a multi-selection opens the bulk confirm, not the single one', async () => {
    const user = userEvent.setup()
    await mountList()
    await selectByCheckbox(user, 'Documents', 'Photos')

    await rightClickOn(user, 'Documents')
    await user.click(screen.getByText('Delete'))

    // The bulk dialog counts every selected entry; the single DeleteModal
    // only ever mentions one entry's name. The right-click opener must
    // reach the same bulk path the toolbar's "Delete selected" uses.
    expect(await screen.findByRole('dialog', { name: 'Delete 2 items?' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Delete folder?' })).toBeNull()
  })

  it('Move inside a multi-selection opens the bulk destination picker, not the single one', async () => {
    const user = userEvent.setup()
    await mountList()
    await selectByCheckbox(user, 'Documents', 'Photos')

    await rightClickOn(user, 'Documents')
    await user.click(screen.getByText('Move / Rename'))

    // BulkMoveModal heading is "Move {N} item(s)".
    expect(await screen.findByRole('dialog', { name: 'Move 2 items' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Move / Rename' })).toBeNull()
  })

  it('Download inside a multi-selection initiates a download for every selected entry, not just the clicked one', async () => {
    const user = userEvent.setup()
    await mountList()
    await selectByCheckbox(user, 'Documents', 'Photos')

    await rightClickOn(user, 'Documents')
    await user.click(screen.getByText('Download'))

    // The user-visible outcome is a download kicked off for each
    // selected entry — the implementer can choose between N single
    // downloads or a new bulk IPC. The contract only requires every
    // selected entry's remote path to reach the download call.
    await waitFor(() => {
      const paths = window.winraid.remote.download.mock.calls.map((c) => c[1])
      expect(paths).toContain('/mnt/user/data/Documents')
      expect(paths).toContain('/mnt/user/data/Photos')
    })
  })

  it('Properties inside a multi-selection opens the multi-entry summary, matching the overflow menu', async () => {
    const user = userEvent.setup()
    await mountList()
    await selectByCheckbox(user, 'Documents', 'Photos')

    // Overflow-menu path — establishes the shape the right-click path
    // must match. (The single-select case from the overflow is covered
    // by BrowseView.propertiesMenu.test.jsx.)
    await user.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Properties' }))
    expect(await screen.findByRole('dialog', { name: '2 items — Properties' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    // Right-click path — same selection, same outcome.
    await rightClickOn(user, 'Documents')
    await user.click(screen.getByText('Properties'))
    expect(await screen.findByRole('dialog', { name: '2 items — Properties' })).toBeTruthy()
  })

  it('Move with a single-entry selection opens the single Move dialog, not the bulk picker', async () => {
    const user = userEvent.setup()
    await mountList()
    await selectByCheckbox(user, 'Documents')

    await rightClickOn(user, 'Documents')
    await user.click(screen.getByText('Move / Rename'))

    expect(await screen.findByRole('dialog', { name: 'Move / Rename' })).toBeTruthy()
    // The bulk picker is a separate dialog — never reached for a
    // one-item selection. Treating any right-click as automatically a
    // bulk action would break this case.
    expect(screen.queryByRole('dialog', { name: 'Move 1 item' })).toBeNull()
  })

  it('Right-click on an entry outside the selection resets the selection to that entry', async () => {
    const user = userEvent.setup()
    await mountList()
    await selectByCheckbox(user, 'Documents', 'Photos')
    expect(rowInput('Documents').checked).toBe(true)
    expect(rowInput('Photos').checked).toBe(true)
    expect(rowInput('readme.txt').checked).toBe(false)

    await rightClickOn(user, 'readme.txt')
    await user.click(screen.getByText('Move / Rename'))

    // The action must target readme.txt (single Move dialog) AND the
    // selection must have collapsed onto it. Both observations are
    // needed — a flow that silently acts on readme.txt while leaving
    // the prior selection intact is exactly the bug.
    expect(await screen.findByRole('dialog', { name: 'Move / Rename' })).toBeTruthy()
    expect(rowInput('Documents').checked).toBe(false)
    expect(rowInput('Photos').checked).toBe(false)
    expect(rowInput('readme.txt').checked).toBe(true)
  })

  it('Right-click with nothing selected still acts on the clicked entry', async () => {
    const user = userEvent.setup()
    await mountList()
    expect(rowInput('Documents').checked).toBe(false)

    await rightClickOn(user, 'Documents')
    await user.click(screen.getByText('Delete'))

    // Single DeleteModal with target=Documents. The no-selection branch
    // of the rule passes today and must keep passing — the suite
    // distinguishes the defect from code that already works.
    const dlg = await screen.findByRole('dialog', { name: 'Delete folder?' })
    expect(within(dlg).getByText('Documents')).toBeTruthy()
  })
})

// ── Grid view ────────────────────────────────────────────────────────────

describe('Right-click on the grid view — same selection semantics', () => {
  it('Delete inside a multi-selection opens the bulk confirm', async () => {
    const user = userEvent.setup()
    await mountGrid()
    await selectByCheckbox(user, 'Documents', 'Photos')

    await rightClickOn(user, 'Documents')
    await user.click(screen.getByText('Delete'))

    expect(await screen.findByRole('dialog', { name: 'Delete 2 items?' })).toBeTruthy()
  })

  it('Properties inside a multi-selection opens the multi-entry summary', async () => {
    const user = userEvent.setup()
    await mountGrid()
    await selectByCheckbox(user, 'Documents', 'Photos')

    await rightClickOn(user, 'Photos')
    await user.click(screen.getByText('Properties'))

    expect(await screen.findByRole('dialog', { name: '2 items — Properties' })).toBeTruthy()
  })
})