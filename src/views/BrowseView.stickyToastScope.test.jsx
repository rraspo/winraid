import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — a warning about the folder you are looking at
// belongs to that folder.
//
// The browser raises two sticky toasts that describe the directory in front
// of you: that this one is a mergerfs union mount nothing can be uploaded
// to, and that this one failed to list. Both are raised by the browse tab,
// and a browse tab stays mounted while it is hidden so it keeps its place —
// so the warning followed you to Settings, to the queue, and to other tabs,
// describing a folder none of them were showing.
//
// Ordinary toasts are unaffected: they are announcements about something
// that happened, and they sit out their few seconds wherever you go. These
// two are different, because they are a statement about what is on screen.
//
// Contract:
//   - the sticky folder warnings show only while this tab is the one on
//     screen
//   - leaving takes them down, returning brings them back while the
//     condition still holds

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

function listResult(entries) {
  return { ok: true, entries }
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
    remote: { list: vi.fn().mockResolvedValue(listResult([{ name: 'readme.txt', type: 'file', size: 1, modified: 0 }])) },
  })
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('list')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  remoteFS.clearAll()
  toast.clearAll()
  delete window.winraid
  vi.restoreAllMocks()
})

// A dismissed toast lingers briefly in an `exiting` state so the host can
// animate it out, so "showing" means present and not on its way out.
function stickyMessages() {
  return toast.getSnapshot().filter((t) => t.sticky && !t.exiting).map((t) => t.msg)
}

// A directory that fails to list raises the sticky error toast, which is the
// easier of the two conditions to provoke from outside the component.
async function mountFailing(props = {}) {
  window.winraid.remote.list = vi.fn().mockResolvedValue({ ok: false, error: 'Listing failed' })
  const view = render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" {...props} />)
  await act(async () => {})
  await act(async () => {})
  return view
}

describe('folder warnings stay with their folder', () => {
  it('shows while the tab is the one on screen', async () => {
    await mountFailing({ active: true })
    expect(stickyMessages()).toContain('Listing failed')
  })

  it('comes down when the tab is no longer on screen', async () => {
    const { rerender } = await mountFailing({ active: true })
    expect(stickyMessages()).toContain('Listing failed')

    rerender(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" active={false} />)
    await act(async () => {})
    expect(stickyMessages()).not.toContain('Listing failed')
  })

  it('comes back when the tab is shown again', async () => {
    const { rerender } = await mountFailing({ active: true })
    rerender(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" active={false} />)
    await act(async () => {})
    expect(stickyMessages()).not.toContain('Listing failed')

    rerender(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" active={true} />)
    await act(async () => {})
    expect(stickyMessages()).toContain('Listing failed')
  })

  it('leaves ordinary toasts alone', async () => {
    const { rerender } = await mountFailing({ active: true })
    toast.show({ msg: 'Copied path', type: 'success' })

    rerender(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" active={false} />)
    await act(async () => {})

    // The announcement is untouched by leaving the tab; only the folder
    // warning went with the folder.
    expect(toast.getSnapshot().map((t) => t.msg)).toContain('Copied path')
    expect(stickyMessages()).not.toContain('Listing failed')
  })
})
