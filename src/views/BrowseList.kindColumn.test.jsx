import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the list view's Kind column: a header label and a
// per-row value derived from the entry's type/extension (src/utils/fileKind.js),
// covering a folder, the media types the app already handles specially,
// and an unrecognized extension. Grid view carries no such column — Kind
// is scoped to the list view only.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

const ENTRIES = [
  { name: 'Photos', type: 'dir', size: 0, modified: Date.now() },
  { name: 'sunrise.jpg', type: 'file', size: 4_200_000, modified: Date.now() },
  { name: 'family-trip.mp4', type: 'file', size: 250_000_000, modified: Date.now() },
  { name: 'archive.xyz', type: 'file', size: 1_024, modified: Date.now() },
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

describe('BrowseList — Kind column', () => {
  it('shows a Kind header label in the list column header', async () => {
    render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" />)
    await screen.findByText('sunrise.jpg')

    const header = document.querySelector('.colHeader')
    expect(header).toBeTruthy()
    expect(header.textContent).toContain('Kind')
  })

  it('labels a folder, the media types the app already handles specially, and an unrecognized extension', async () => {
    render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" />)
    await screen.findByText('sunrise.jpg')

    const rows = document.querySelectorAll('[data-entry-path]')
    const kindOf = (name) => {
      const row = Array.from(rows).find((r) => r.getAttribute('data-entry-path').endsWith(name))
      return row.querySelector('.rowKind').textContent
    }
    expect(kindOf('Photos')).toBe('File folder')
    expect(kindOf('sunrise.jpg')).toBe('JPEG image')
    expect(kindOf('family-trip.mp4')).toBe('MP4 video')
    expect(kindOf('archive.xyz')).toBe('XYZ file')
  })

  it('has no Kind column in grid view', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" />)
    await screen.findByText('sunrise.jpg')

    await user.click(screen.getByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('menuitem', { name: 'Grid view' }))
    await screen.findByText('sunrise.jpg')

    expect(document.querySelector('.colHeader')).toBeNull()
    expect(document.querySelector('.rowKind')).toBeNull()
  })
})
