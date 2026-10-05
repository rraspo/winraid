import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the select-all checkbox stays only in the list
// view's column header. Grid view has no header row of its own, so grid
// users only reach "select all" through the overflow menu's "Select all"
// item — this is deliberate, not a gap: a natural redundancy for list
// view, not one grid needs too.
//
// Both modes are asserted within one render, switching through the View
// button in the toolbar (rather than a second render seeded by a different
// localStorage value) — this environment's Storage mock does not reliably
// carry a changed value into a freshly-mounted second render within the
// same test file.

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

describe('select-all checkbox — list header only', () => {
  it('shows a select-all checkbox in the list column header, and none once switched to grid', async () => {
    const user = userEvent.setup()
    render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" />)
    await screen.findByText('readme.txt')

    const header = document.querySelector('.colHeader')
    expect(header).toBeTruthy()
    expect(header.querySelector('input[type="checkbox"]')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('menuitem', { name: 'Grid view' }))
    await screen.findByText('readme.txt')

    expect(document.querySelector('.colHeader')).toBeNull()
  })
})
