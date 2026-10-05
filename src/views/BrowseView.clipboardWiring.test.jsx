import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

// Contract under test — the remote browser's clipboard cut/copy/paste: the
// toolbar's Cut/Copy/Paste buttons are wired through window.winraid.clipboard.*
// and window.winraid.remote.move/copy rather than sitting disabled. Enablement
// rules differ per button: Cut/Copy follow the selection (Copy additionally
// needs the connection to support server-side exec), Paste follows clipboard
// presence alone — see BrowseView.redesign.test.jsx for that base assertion.
// This file covers the actual cut/copy/paste round trip and the
// exec-capability gate.

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

const ROOT_ENTRIES = [
  { name: 'Documents', type: 'dir', size: 0, modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
]

const DOCS_ENTRIES = [
  { name: 'notes.txt', type: 'file', size: 10, modified: Date.now() },
]

function setup({ execCapable = true, listOverride } = {}) {
  // A stateful clipboard double — the shared createWinraidMock's default
  // always resolves get() to null, which is right for tests that never call
  // set(), but this file drives the real set → get → paste → clear round
  // trip, so it needs a fake that actually remembers what was set.
  let clipboardEntry = null
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        if (key === 'activeConnectionId') return Promise.resolve('conn-1')
        return Promise.resolve({ connections: CONNECTIONS, activeConnectionId: 'conn-1' })
      }),
    },
    clipboard: {
      set: vi.fn().mockImplementation((mode, connectionId, paths) => {
        clipboardEntry = { mode, connectionId, paths }
        return Promise.resolve({ ok: true })
      }),
      get: vi.fn().mockImplementation(() => Promise.resolve(clipboardEntry)),
      clear: vi.fn().mockImplementation(() => {
        clipboardEntry = null
        return Promise.resolve({ ok: true })
      }),
    },
    remote: {
      list: listOverride ?? vi.fn().mockImplementation((_id, path) =>
        Promise.resolve({ ok: true, entries: path === '/mnt/user/data/Documents' ? DOCS_ENTRIES : ROOT_ENTRIES })),
      execCapable: vi.fn().mockResolvedValue({ ok: true, capable: execCapable }),
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

async function mount() {
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" favoritesByConnection={{}} onToggleFavorite={vi.fn()} />)
  await screen.findByText('readme.txt')
  await act(async () => {})
}

function commandRow() {
  return screen.getByRole('toolbar', { name: 'Browser commands' })
}

async function selectReadme(user) {
  const rowEl = screen.getByText('readme.txt').closest('.row')
  await user.click(rowEl.querySelector('.checkbox'))
}

async function openDocuments(user) {
  await user.dblClick(screen.getByText('Documents'))
  await screen.findByText('notes.txt')
}

describe('BrowseView clipboard wiring — cut/copy/paste', () => {
  it('cut then paste into a different folder performs a server-side move and clears the clipboard', async () => {
    const user = userEvent.setup()
    setup()
    await mount()
    await selectReadme(user)
    await user.click(within(commandRow()).getByRole('button', { name: 'Cut' }))

    await openDocuments(user)
    expect(within(commandRow()).getByRole('button', { name: 'Paste' })).toBeEnabled()

    await user.click(within(commandRow()).getByRole('button', { name: 'Paste' }))

    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/mnt/user/data/readme.txt', '/mnt/user/data/Documents/readme.txt')
    expect(window.winraid.remote.copy).not.toHaveBeenCalled()
    expect(window.winraid.clipboard.clear).toHaveBeenCalled()
    // A successful paste clears the clipboard — Paste goes back to disabled.
    await waitFor(() => expect(within(commandRow()).getByRole('button', { name: 'Paste' })).toBeDisabled())
  })

  it('copy then paste performs a server-side copy, not a move', async () => {
    const user = userEvent.setup()
    setup()
    await mount()
    await selectReadme(user)
    await user.click(within(commandRow()).getByRole('button', { name: 'Copy' }))

    await openDocuments(user)
    await user.click(within(commandRow()).getByRole('button', { name: 'Paste' }))

    expect(window.winraid.remote.copy).toHaveBeenCalledWith('conn-1', '/mnt/user/data/readme.txt', '/mnt/user/data/Documents/readme.txt')
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })

  it('disables Copy (but not Cut) on a connection with no server-side exec', async () => {
    const user = userEvent.setup()
    setup({ execCapable: false })
    await mount()
    await selectReadme(user)

    expect(within(commandRow()).getByRole('button', { name: 'Cut' })).toBeEnabled()
    expect(within(commandRow()).getByRole('button', { name: 'Copy' })).toBeDisabled()
  })

  it('a failed paste leaves the clipboard intact and Paste enabled for retry', async () => {
    const user = userEvent.setup()
    setup()
    window.winraid.remote.move = vi.fn().mockResolvedValue({ ok: false, error: 'Permission denied' })
    await mount()
    await selectReadme(user)
    await user.click(within(commandRow()).getByRole('button', { name: 'Cut' }))
    await openDocuments(user)

    await user.click(within(commandRow()).getByRole('button', { name: 'Paste' }))

    expect(window.winraid.clipboard.clear).not.toHaveBeenCalled()
    expect(within(commandRow()).getByRole('button', { name: 'Paste' })).toBeEnabled()
  })
})
