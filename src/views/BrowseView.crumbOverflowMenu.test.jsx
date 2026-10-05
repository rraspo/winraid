import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the "..." that appears when the trail runs out of
// room is a way through, not a decoration.
//
// The trail keeps every crumb and scrolls, pinned to the folder you are in,
// so the folders above it slide out of view behind a sticky "..." marker.
// That marker was plain text with an opaque background: it told you the path
// continued and then swallowed the clicks of whatever it was covering, which
// left no way to walk up except the sync-root button.
//
// It is now a control. Choosing it lists the folders above the one you are
// in, and picking one goes there — the same move the visible crumbs make.
//
// DOM contract:
//   - the marker is a <button aria-label="Hidden folders"> carrying
//     aria-haspopup="menu" and aria-expanded, rendered only while the trail
//     overflows
//   - choosing it opens a role="menu" of role="menuitem" entries, one per
//     folder above the current one, outermost first, named by folder
//   - picking one navigates there and closes the menu
//   - Escape closes it without navigating
//
// One thing here cannot be tested at this level. The trail clips its own
// overflow, so a menu nested inside it is in the DOM and invisible — which
// is what the first attempt did, and these tests passed anyway, because
// jsdom has no clipping. The menu is drawn at the document level for that
// reason, and that it is actually visible and hit-testable is checked in
// the preview harness, not here.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

const ENTRIES = [{ name: 'readme.txt', type: 'file', size: 10, modified: 0 }]

// jsdom gives every element zero width, so overflow is forced the way the
// component sees it: scrollWidth wider than clientWidth on the trail.
function forceTrailOverflow() {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return 400 } })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 100 } })
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
  forceTrailOverflow()
})

afterEach(() => {
  remoteFS.clearAll()
  toast.clearAll()
  delete window.winraid
  vi.restoreAllMocks()
})

async function mount() {
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" />)
  await screen.findByText('readme.txt')
  await act(async () => {})
}

function marker() {
  return screen.getByRole('button', { name: 'Hidden folders' })
}

describe('the breadcrumb overflow marker', () => {
  it('is a control rather than plain text', async () => {
    await mount()
    expect(marker().getAttribute('aria-haspopup')).toBe('menu')
    expect(marker().getAttribute('aria-expanded')).toBe('false')
  })

  it('lists the folders above the one you are in, outermost first', async () => {
    await mount()
    fireEvent.click(marker())
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent.trim())).toEqual(['root', 'mnt', 'user'])
  })

  it('goes to a folder picked from the list', async () => {
    await mount()
    fireEvent.click(marker())
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'mnt' }))
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Hidden folders' })).toBeTruthy()
    expect(window.winraid.remote.list).toHaveBeenCalledWith(expect.anything(), '/mnt')
  })

  it('closes once a folder is picked', async () => {
    await mount()
    fireEvent.click(marker())
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'mnt' }))
    await act(async () => {})
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape without going anywhere', async () => {
    await mount()
    fireEvent.click(marker())
    expect(screen.getByRole('menu')).toBeTruthy()
    const callsBefore = window.winraid.remote.list.mock.calls.length
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => {})
    expect(screen.queryByRole('menu')).toBeNull()
    expect(window.winraid.remote.list.mock.calls.length).toBe(callsBefore)
  })
})
