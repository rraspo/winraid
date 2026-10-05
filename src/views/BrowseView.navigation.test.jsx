import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the Forward and Up one level controls in nav row 1.
//
// Forward renders from props alone: the per-tab useNavHistory stack lives in
// App.jsx, which drives onForward/canGoForward — the exact props onBack and
// canGoBack already use for Back. BrowseView's own job is just to render the
// button and wire those two props through, so that is what is tested here.
//
// Up one level is new: it derives the parent of the current directory and
// calls the same navigate() the breadcrumb trail's own ancestor clicks use.
// It reads a different source than "Jump to sync root" (the overflow menu's
// item for the connection's configured root) — the last test proves the two
// controls send you to different places from the same starting folder.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

// Static across every remote.list call, regardless of the path requested —
// good enough to prove navigation targets without modelling a real tree.
const ENTRIES = [
  { name: 'incoming', type: 'dir',  size: 0,     modified: Date.now() },
  { name: 'today',    type: 'dir',  size: 0,     modified: Date.now() },
  { name: 'first.jpg', type: 'file', size: 1024, modified: Date.now() },
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

// Folder names repeat at every level in this fixture (the mock resolves the
// same static listing for any path), so "incoming" and "today" appear both
// as a row to click into and, once visited, as a breadcrumb segment —
// getByText alone is ambiguous between the two. Rows carry a stable
// data-entry-path attribute the breadcrumb does not, so target that.
function folderRow(name) {
  return document.querySelector(`[data-entry-path$="/${name}"]`)
}

async function mount(props = {}) {
  const onHistoryPush = vi.fn()
  render(<BrowseView onHistoryPush={onHistoryPush} connectionId="conn-1" {...props} />)
  await screen.findByText('first.jpg')
  await act(async () => {})
  onHistoryPush.mockClear() // ignore whatever the initial load recorded
  return { onHistoryPush, user: userEvent.setup() }
}

describe('Forward', () => {
  it('is disabled with no onForward/canGoForward wired, the same as Back with no onBack/canGoBack', async () => {
    await mount()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })

  it('is disabled when the owning tab reports no forward history', async () => {
    await mount({ canGoForward: false })
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled()
  })

  it('calls the parent-owned forward handler when the tab has forward history', async () => {
    const onForward = vi.fn()
    const { user } = await mount({ onForward, canGoForward: true })
    const button = screen.getByRole('button', { name: 'Forward' })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(onForward).toHaveBeenCalledTimes(1)
  })
})

describe('Up one level', () => {
  it('navigates to the parent of the current directory, not the sync root', async () => {
    const { onHistoryPush, user } = await mount()
    // Two folder clicks put the tab two levels below the connection's
    // configured root — /mnt/user/data/incoming/today.
    await user.click(folderRow('incoming'))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    onHistoryPush.mockClear()
    await user.click(folderRow('today'))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    onHistoryPush.mockClear()

    await user.click(screen.getByRole('button', { name: 'Up one level' }))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    expect(onHistoryPush.mock.calls.at(-1)[0]).toMatchObject({
      kind: 'browse',
      path: '/mnt/user/data/incoming',
    })
    onHistoryPush.mockClear()

    // A second Up climbs one more segment, landing on the connection's
    // configured root — the same destination "Jump to sync root" reaches,
    // but arrived at by walking the tree rather than jumping there.
    await user.click(screen.getByRole('button', { name: 'Up one level' }))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    expect(onHistoryPush.mock.calls.at(-1)[0]).toMatchObject({
      kind: 'browse',
      path: '/mnt/user/data',
    })
  })

  it('is disabled at the filesystem root', async () => {
    const { user } = await mount()
    // The breadcrumb trail always carries a root crumb (icon-only, no
    // text) regardless of the connection's configured root — click it to
    // reach the actual top of the tree.
    const rootCrumb = document.querySelectorAll('.crumb')[0]
    await user.click(rootCrumb)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Up one level' })).toBeDisabled()
  })

  it('targets a different folder than "Jump to sync root" from the same starting path', async () => {
    const { onHistoryPush, user } = await mount()
    // Land two levels below the sync root: /mnt/user/data/incoming/today.
    await user.click(folderRow('incoming'))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    onHistoryPush.mockClear()
    await user.click(folderRow('today'))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    onHistoryPush.mockClear()

    // From that folder, Up goes to its immediate parent...
    await user.click(screen.getByRole('button', { name: 'Up one level' }))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    const upTarget = onHistoryPush.mock.calls.at(-1)[0].path
    expect(upTarget).toBe('/mnt/user/data/incoming')
    onHistoryPush.mockClear()

    // ...walk back down to the exact same starting folder...
    await user.click(folderRow('today'))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    onHistoryPush.mockClear()

    // ...and from there, "Jump to sync root" goes to the connection's fixed
    // configured root instead — a different destination for the same start.
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Jump to sync root' }))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    const homeTarget = onHistoryPush.mock.calls.at(-1)[0].path
    expect(homeTarget).toBe('/mnt/user/data')

    expect(upTarget).not.toBe(homeTarget)
  })
})
