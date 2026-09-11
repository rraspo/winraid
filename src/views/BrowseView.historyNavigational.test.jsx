import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — history is where you have been, not what you have
// looked at. Back and forward walk folders only.
//
// Opening a file used to push a history entry, stepping to the next file in
// the viewer pushed another, and closing the viewer pushed a third that
// named the folder you were already standing in. Back then replayed a
// slideshow instead of walking up the tree, and several presses in a row
// went nowhere at all because the entries all shared one path.
//
// Contract:
//   - opening a file records nothing
//   - moving between files inside the viewer records nothing
//   - closing the viewer records nothing
//   - deleting from the viewer records nothing
//   - walking into a folder still records that move, so Back still works
//   - nothing that is recorded carries a file to reopen

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

// Text files open the editor rather than the viewer, so the files here are
// the kind the viewer actually handles.
const ENTRIES = [
  { name: 'Documents', type: 'dir',  size: 0,     modified: Date.now() },
  { name: 'first.jpg',  type: 'file', size: 1024, modified: Date.now() },
  { name: 'second.jpg', type: 'file', size: 2048, modified: Date.now() },
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

async function mount() {
  const onHistoryPush = vi.fn()
  render(<BrowseView onHistoryPush={onHistoryPush} connectionId="conn-1" />)
  await screen.findByText('first.jpg')
  await act(async () => {})
  onHistoryPush.mockClear() // ignore whatever the initial load recorded
  return { onHistoryPush, user: userEvent.setup() }
}

function viewer() {
  return screen.queryByRole('dialog', { name: /^Quick Look: / })
}

describe('browser history is strictly navigational', () => {
  it('records nothing when a file is opened', async () => {
    const { onHistoryPush, user } = await mount()
    await user.click(screen.getByText('first.jpg'))
    await waitFor(() => expect(viewer()).toBeTruthy())
    expect(onHistoryPush).not.toHaveBeenCalled()
  })

  it('records nothing when the viewer is closed', async () => {
    const { onHistoryPush, user } = await mount()
    await user.click(screen.getByText('first.jpg'))
    await waitFor(() => expect(viewer()).toBeTruthy())
    onHistoryPush.mockClear()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(viewer()).toBeNull())
    expect(onHistoryPush).not.toHaveBeenCalled()
  })

  it('records nothing when stepping to the next file in the viewer', async () => {
    const { onHistoryPush, user } = await mount()
    await user.click(screen.getByText('first.jpg'))
    await waitFor(() => expect(viewer()).toBeTruthy())
    onHistoryPush.mockClear()

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(viewer().getAttribute('aria-label')).toContain('second.jpg'))
    expect(onHistoryPush).not.toHaveBeenCalled()
  })

  it('still records walking into a folder', async () => {
    const { onHistoryPush, user } = await mount()
    await user.click(screen.getByText('Documents'))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())
    expect(onHistoryPush.mock.calls.at(-1)[0]).toMatchObject({
      kind: 'browse',
      path: '/mnt/user/data/Documents',
    })
  })

  it('never records a file to reopen', async () => {
    const { onHistoryPush, user } = await mount()
    await user.click(screen.getByText('first.jpg'))
    await waitFor(() => expect(viewer()).toBeTruthy())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(viewer()).toBeNull())
    await user.click(screen.getByText('Documents'))
    await waitFor(() => expect(onHistoryPush).toHaveBeenCalled())

    for (const [entry] of onHistoryPush.mock.calls) {
      expect(entry.quickLookFile ?? null).toBeNull()
    }
  })
})
