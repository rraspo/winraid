import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — middle-clicking a folder opens it in another tab
// without leaving the one you are in, the way a browser opens a link. A
// plain click still navigates in place.
//
//   onOpenTab(connectionId, 'browse', { path, newTab: true, background: true })

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

const ENTRIES = [
  { name: 'Documents', type: 'dir',  size: 0,    modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
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
  const onOpenTab = vi.fn()
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" onOpenTab={onOpenTab} />)
  await screen.findByText('readme.txt')
  await act(async () => {})
  return { onOpenTab }
}

describe('BrowseView middle click opens a folder in another tab', () => {
  it('asks for a background tab at that folder', async () => {
    const { onOpenTab } = await mount()
    const folderRow = screen.getByText('Documents').closest('.row')
    fireEvent.mouseDown(folderRow, { button: 1 })
    expect(onOpenTab).toHaveBeenCalledWith(
      'conn-1',
      'browse',
      expect.objectContaining({ path: '/mnt/user/data/Documents', newTab: true, background: true }),
    )
  })

  it('leaves files alone', async () => {
    const { onOpenTab } = await mount()
    const fileRow = screen.getByText('readme.txt').closest('.row')
    fireEvent.mouseDown(fileRow, { button: 1 })
    expect(onOpenTab).not.toHaveBeenCalled()
  })

  it('still navigates in place on a plain click', async () => {
    const { onOpenTab } = await mount()
    fireEvent.click(screen.getByText('Documents').closest('.row'))
    await act(async () => {})
    expect(onOpenTab).not.toHaveBeenCalled()
    expect(window.winraid.remote.list).toHaveBeenCalledWith('conn-1', '/mnt/user/data/Documents')
  })
})
