import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const TEST_CONNECTIONS = [
  {
    id: 'conn-1',
    name: 'Kepler',
    localFolder: 'C:\\sync',
    sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' },
  },
]

const SAMPLE_ENTRIES = [
  { name: 'Documents', type: 'dir', size: 0, modified: Date.now() },
  { name: 'Photos', type: 'dir', size: 0, modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
  { name: 'video.mp4', type: 'file', size: 52428800, modified: Date.now() },
]

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
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
      list: vi.fn().mockResolvedValue({ ok: true, entries: SAMPLE_ENTRIES }),
    },
  })

  // Stub localStorage for view mode persistence
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('list')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})

  // Mock scroll container dimensions for @tanstack/react-virtual
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  delete window.winraid
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BrowseView', () => {
  it('renders the header with title', async () => {
    render(<BrowseView onHistoryPush={() => {}} />)
    expect(await screen.findByText('Browse Remote')).toBeInTheDocument()
  })

  it('renders breadcrumb path segments', async () => {
    render(<BrowseView onHistoryPush={() => {}} />)
    // Wait for entries to load (proves the component initialized)
    await screen.findByText('Documents')

    // Breadcrumb should include path segments from the connection's remotePath
    expect(screen.getByText('mnt')).toBeInTheDocument()
    expect(screen.getByText('user')).toBeInTheDocument()
    expect(screen.getByText('data')).toBeInTheDocument()
  })

  it('renders list view column headers', async () => {
    render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('Modified')).toBeInTheDocument()
  })

  it('renders directory and file entries in list view', async () => {
    render(<BrowseView onHistoryPush={() => {}} />)

    expect(await screen.findByText('Documents')).toBeInTheDocument()
    expect(screen.getByText('Photos')).toBeInTheDocument()
    expect(screen.getByText('readme.txt')).toBeInTheDocument()
    expect(screen.getByText('video.mp4')).toBeInTheDocument()
  })

  it('shows empty folder message when directory has no entries', async () => {
    window.winraid.remote.list.mockResolvedValue({ ok: true, entries: [] })

    render(<BrowseView onHistoryPush={() => {}} />)
    expect(await screen.findByText('Empty folder')).toBeInTheDocument()
  })

  it('shows error banner on fetch failure', async () => {
    window.winraid.remote.list.mockResolvedValue({
      ok: false,
      error: 'Connection refused',
    })

    render(<BrowseView onHistoryPush={() => {}} />)
    expect(await screen.findByText('Connection refused')).toBeInTheDocument()
  })

  it('grid mode renders card elements with names', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('grid')

    render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    // All entry names should be visible as grid card text
    expect(screen.getByText('Photos')).toBeInTheDocument()
    expect(screen.getByText('readme.txt')).toBeInTheDocument()
    expect(screen.getByText('video.mp4')).toBeInTheDocument()
  })

  it('grid cards contain a menu button', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('grid')

    const { container } = render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    // Each card should have a menu button (the 3-dot MoreHorizontal icon)
    const menuButtons = container.querySelectorAll('.menuDotBtn')
    expect(menuButtons.length).toBe(SAMPLE_ENTRIES.length)
  })

  it('displays file sizes in list view', async () => {
    render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    // File sizes should be formatted and displayed
    expect(screen.getByText('1.0 KB')).toBeInTheDocument()  // readme.txt
    expect(screen.getByText('50.0 MB')).toBeInTheDocument() // video.mp4
  })

  // ── Drag-and-drop ──────────────────────────────────────────────────────

  it('list rows are draggable', async () => {
    const { container } = render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    const rows = container.querySelectorAll('.row')
    for (const row of rows) {
      expect(row.getAttribute('draggable')).toBe('true')
    }
  })

  it('grid cards are draggable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('grid')

    const { container } = render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    const cards = container.querySelectorAll('.gridCard')
    for (const card of cards) {
      expect(card.getAttribute('draggable')).toBe('true')
    }
  })

  it('shows move overlay during drag-drop move operation', async () => {
    // Make move hang so we can observe the overlay
    let resolveMove
    window.winraid.remote.move = vi.fn().mockImplementation(
      () => new Promise((r) => { resolveMove = r })
    )

    const { container } = render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    // Simulate drag start on readme.txt
    const fileRow = screen.getByText('readme.txt').closest('.row')
    fireEvent.dragStart(fileRow, { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() } })

    // Drop on Documents folder
    const dirRow = screen.getByText('Documents').closest('.row')
    fireEvent.dragOver(dirRow)
    fireEvent.drop(dirRow)

    // Move overlay should be visible while the operation is pending
    expect(await screen.findByText(/Moving readme\.txt/)).toBeInTheDocument()
    expect(container.querySelector('.moveOverlay')).toBeInTheDocument()

    // Resolve the move and flush async updates
    await act(async () => { resolveMove({ ok: true }) })

    // Overlay should disappear and success status should show
    expect(container.querySelector('.moveOverlay')).toBeNull()
    expect(screen.getByText(/Moved readme\.txt/)).toBeInTheDocument()
  })

  it('refetches directory listing on move error (rollback)', async () => {
    window.winraid.remote.move = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Cross-device rename not supported',
    })

    render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    // Clear the call count from initial load
    window.winraid.remote.list.mockClear()

    // Simulate drag-drop move: drag readme.txt onto Documents
    const fileRow = screen.getByText('readme.txt').closest('.row')
    fireEvent.dragStart(fileRow, { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() } })

    const dirRow = screen.getByText('Documents').closest('.row')
    fireEvent.dragOver(dirRow)
    fireEvent.drop(dirRow)

    // Wait for error status and refetch
    await waitFor(() => {
      expect(screen.getByText('Cross-device rename not supported')).toBeInTheDocument()
      expect(window.winraid.remote.list).toHaveBeenCalled()
    })
  })

  // ── Last-visited highlight ──────────────────────────────────────────────

  it('highlights last-visited folder when navigating up', async () => {
    // Start in a subfolder /mnt/user/data/Documents
    const subEntries = [
      { name: 'notes.txt', type: 'file', size: 100, modified: Date.now() },
    ]

    let callCount = 0
    window.winraid.remote.list = vi.fn().mockImplementation(() => {
      callCount++
      // First call: initial load at /mnt/user/data (from connection remotePath)
      if (callCount === 1) return Promise.resolve({ ok: true, entries: SAMPLE_ENTRIES })
      // Second call: navigated into Documents subfolder
      if (callCount === 2) return Promise.resolve({ ok: true, entries: subEntries })
      // Third call: navigated back up to /mnt/user/data
      return Promise.resolve({ ok: true, entries: SAMPLE_ENTRIES })
    })

    const user = userEvent.setup()
    render(<BrowseView onHistoryPush={() => {}} />)

    // Wait for initial entries
    await screen.findByText('Documents')

    // Navigate into Documents
    await user.click(screen.getByText('Documents'))
    await screen.findByText('notes.txt')

    // Navigate back up via breadcrumb "data"
    await user.click(screen.getByText('data'))
    await screen.findByText('Documents')

    // The Documents folder row should have the lastVisited class
    const docRow = screen.getByText('Documents').closest('.row')
    expect(docRow.className).toContain('lastVisited')
  })
})
