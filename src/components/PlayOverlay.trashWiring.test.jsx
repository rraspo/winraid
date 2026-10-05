import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import PlayOverlay from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — Play's own delete dialogs read the same
// `trashByConnection` map the rest of the app does: the single-file dialog
// (opened from Quick Look) and the bulk dialog (opened from the wall
// selection) both need to know whether the active connection has a trash
// folder configured, so the wording and the confirm button tell the truth.
//
// DeleteModal, BulkDeleteModal and QuickLookOverlay are stubbed so this test
// exercises only the prop PlayOverlay derives and passes down, not their own
// rendering (covered elsewhere).

vi.mock('./modals/DeleteModal', () => ({
  default: ({ trashed }) => <div data-testid="delete-modal" data-trashed={String(!!trashed)} />,
}))
vi.mock('./modals/BulkDeleteModal', () => ({
  default: ({ trashed }) => <div data-testid="bulk-delete-modal" data-trashed={String(!!trashed)} />,
}))
vi.mock('./QuickLookOverlay', () => ({
  default: ({ onDelete }) => (
    <button onClick={() => onDelete({ name: 'a.jpg', path: '/photos/a.jpg', isDir: false })}>
      request-single-delete
    </button>
  ),
}))

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let onMediaFoundCb = null
let onMediaDoneCb  = null

beforeEach(() => {
  window.IntersectionObserver     = IntersectionObserverStub
  window.ResizeObserver           = ResizeObserverStub
  globalThis.IntersectionObserver = IntersectionObserverStub
  globalThis.ResizeObserver       = ResizeObserverStub
  onMediaFoundCb = null
  onMediaDoneCb  = null
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({ recursive: true, shuffle: false }) },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => {} }),
      onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => {} }),
      onMediaError: vi.fn().mockReturnValue(() => {}),
      delete:       vi.fn().mockResolvedValue({ ok: true, trashed: false }),
    },
  })
})

afterEach(() => { delete window.winraid })

const baseProps = {
  connectionId:   'c1',
  path:           '/photos',
  onClose:        vi.fn(),
  remoteBasePath: '/photos',
  canServerEdit:  true,
  onMutated:      vi.fn(),
}

async function mount(props) {
  render(<PlayOverlay {...baseProps} {...props} />)
  await act(async () => {})
  act(() => { onMediaFoundCb?.({ files: [{ path: '/photos/a.jpg', size: 1, mtime: 0, type: 'image' }] }) })
  act(() => { onMediaDoneCb?.({ totalMatches: 1, durationMs: 1 }) })
}

describe('PlayOverlay trash wiring', () => {
  it('tells the single-delete dialog the connection has a trash folder', async () => {
    await mount({ trashByConnection: { c1: { folder: '/mnt/user/media' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg', hidden: true }))
    fireEvent.click(screen.getByRole('button', { name: 'request-single-delete' }))
    expect(screen.getByTestId('delete-modal').dataset.trashed).toBe('true')
  })

  it('assumes permanent for the single-delete dialog when no folder is configured', async () => {
    await mount({})
    fireEvent.click(screen.getByRole('button', { name: 'Open a.jpg', hidden: true }))
    fireEvent.click(screen.getByRole('button', { name: 'request-single-delete' }))
    expect(screen.getByTestId('delete-modal').dataset.trashed).toBe('false')
  })

  it('tells the bulk-delete dialog the connection has a trash folder', async () => {
    await mount({ trashByConnection: { c1: { folder: '/mnt/user/media' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Select a.jpg', hidden: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    expect(screen.getByTestId('bulk-delete-modal').dataset.trashed).toBe('true')
  })

  it('assumes permanent for the bulk-delete dialog when no folder is configured for this connection', async () => {
    await mount({ trashByConnection: { other: { folder: '/mnt/user/media' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Select a.jpg', hidden: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    expect(screen.getByTestId('bulk-delete-modal').dataset.trashed).toBe('false')
  })
})
