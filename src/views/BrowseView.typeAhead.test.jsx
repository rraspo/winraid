import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({
  default: ({ onClose }) => (
    <div data-testid="play-overlay">
      <button onClick={onClose}>close-play</button>
    </div>
  ),
}))

const TEST_CONNECTIONS = [
  {
    id: 'conn-1',
    name: 'Kepler',
    localFolder: 'C:\\sync',
    sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' },
  },
]

// Deliberately unsorted, so the raw fetch order neither matches the active
// filter nor the active sort. `fantastic.txt` starts with 'f' but does not
// contain "file" — it is excluded once the user filters to "file" and must
// never be rendered nor targeted by type-to-jump. `file_a.txt`/`file_b.txt`
// both stay visible and, under a Z-A sort, `file_b.txt` sorts ahead of
// `file_a.txt`.
const RAW_ENTRIES = [
  { name: 'fantastic.txt', type: 'file', size: 10, modified: Date.now() },
  { name: 'file_a.txt',    type: 'file', size: 20, modified: Date.now() },
  { name: 'file_b.txt',    type: 'file', size: 30, modified: Date.now() },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(TEST_CONNECTIONS)
        if (key === 'activeConnectionId') return Promise.resolve('conn-1')
        return Promise.resolve({
          connections: TEST_CONNECTIONS,
          activeConnectionId: 'conn-1',
        })
      }),
    },
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: RAW_ENTRIES }),
    },
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

describe('BrowseView — type-to-jump respects the filtered/sorted view', () => {
  it('jumps to the matching visible row, never a filtered-out row, under an active filter + sort', async () => {
    const user = userEvent.setup()
    const { container } = render(<BrowseView onHistoryPush={() => {}} />)

    // Wait for the raw listing to load.
    await screen.findByText('fantastic.txt')

    // Switch sort to Name Z-A.
    await user.click(screen.getByLabelText('Sort order'))
    await user.click(screen.getByText('Name Z-A'))

    // Filter to "file" — excludes fantastic.txt, keeps file_a.txt/file_b.txt.
    const searchInput = screen.getByPlaceholderText('Search this folder')
    await user.type(searchInput, 'file')

    await waitFor(() => {
      expect(screen.queryByText('fantastic.txt')).not.toBeInTheDocument()
      expect(screen.getByText('file_a.txt')).toBeInTheDocument()
      expect(screen.getByText('file_b.txt')).toBeInTheDocument()
    })

    // Sanity check: Z-A sort puts file_b.txt ahead of file_a.txt.
    const rows = container.querySelectorAll('.row')
    const rowNames = Array.from(rows)
      .map((r) => r.querySelector('[class*="name"]')?.textContent)
      .filter(Boolean)
    expect(rowNames.indexOf('file_b.txt')).toBeLessThan(rowNames.indexOf('file_a.txt'))

    // Move focus off the search input so the document-level type-to-jump
    // handler doesn't bail out (it ignores keystrokes while an <input> is
    // focused).
    searchInput.blur()

    // Type the prefix "f" — matches fantastic.txt (filtered out, invisible),
    // file_a.txt and file_b.txt (both visible). The correct target is
    // file_b.txt: the first visible row, per the active filter+sort, whose
    // name starts with "f".
    fireEvent.keyDown(document, { key: 'f' })

    const fileBRow = screen.getByText('file_b.txt').closest('.row')
    const fileARow = screen.getByText('file_a.txt').closest('.row')

    await waitFor(() => expect(fileBRow.className).toContain('cursor'))
    expect(fileARow.className).not.toContain('cursor')
  })
})
