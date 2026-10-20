import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import DownloadsPanel from './DownloadsPanel'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — downloads show in a panel mounted once at the app
// root, so they keep running and stay visible whatever screen is open.
//
// The panel lists every job from downloads.list() and follows
// downloads.onUpdate snapshots. Per job, <li aria-label="<label>">:
//   - preparing: "Preparing…" while the folder is walked
//   - running: a progressbar at bytesDone / bytesTotal, "<n> of <m> files ·
//     <done> of <total>" (just the bytes for a single file), the file in
//     flight, and "Cancel download" calling downloads.cancel(id)
//   - done: "Downloaded to <destination>", "Show in folder" calling
//     local.reveal(destination); it clears itself after a few seconds
//   - canceled: "Canceled", also clearing itself
//   - failed: the reason in an alert; it stays until dismissed
// Dismissing calls downloads.dismiss(id) and removes the row.

const RUNNING = {
  id: 'j1', connectionId: 'atlas', label: 'photos', destination: 'C:\\dl\\photos',
  state: 'running', filesDone: 37, filesTotal: 124, bytesDone: 500 * 1024 ** 2, bytesTotal: 2 * 1024 ** 3,
  currentFile: 'IMG_0412.jpg', error: null,
}

function mount({ jobs = [] } = {}) {
  let push = () => {}
  window.winraid = createWinraidMock({
    downloads: {
      list: vi.fn().mockResolvedValue(jobs),
      onUpdate: vi.fn().mockImplementation((callback) => { push = callback; return () => {} }),
    },
  })
  render(<DownloadsPanel />)
  return { emit: (snapshot) => act(async () => { push(snapshot) }) }
}

afterEach(() => {
  vi.useRealTimers()
  delete window.winraid
})

describe('DownloadsPanel', () => {
  it('renders nothing while there are no downloads', async () => {
    mount()
    await act(async () => {})
    expect(screen.queryByRole('region', { name: 'Downloads' })).toBeNull()
  })

  it('shows a running download with real progress and a way to cancel it', async () => {
    mount({ jobs: [RUNNING] })
    await act(async () => {})
    const row = screen.getByRole('listitem', { name: 'photos' })
    expect(within(row).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('24')
    expect(row.textContent).toContain('37 of 124 files')
    expect(row.textContent).toContain('500.0 MB of 2.00 GB')
    expect(row.textContent).toContain('IMG_0412.jpg')

    fireEvent.click(within(row).getByRole('button', { name: 'Cancel download' }))
    expect(window.winraid.downloads.cancel).toHaveBeenCalledWith('j1')
  })

  it('shows only the bytes for a single file', async () => {
    mount({ jobs: [{ ...RUNNING, label: 'big.iso', filesTotal: 1, filesDone: 0 }] })
    await act(async () => {})
    const row = screen.getByRole('listitem', { name: 'big.iso' })
    expect(row.textContent).not.toContain('files')
    expect(row.textContent).toContain('500.0 MB of 2.00 GB')
  })

  it('follows updates as they arrive, adding new jobs', async () => {
    const { emit } = mount()
    await act(async () => {})
    await emit({ ...RUNNING, state: 'preparing', filesTotal: 0, bytesTotal: 0, bytesDone: 0, filesDone: 0, currentFile: null })
    expect(screen.getByRole('listitem', { name: 'photos' }).textContent).toContain('Preparing')
    await emit({ ...RUNNING, bytesDone: 1024 ** 3 })
    expect(within(screen.getByRole('listitem', { name: 'photos' })).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50')
  })

  it('says where a finished download went, offers to show it, then clears itself', async () => {
    vi.useFakeTimers()
    const { emit } = mount({ jobs: [RUNNING] })
    await act(async () => {})
    await emit({ ...RUNNING, state: 'done', filesDone: 124, bytesDone: RUNNING.bytesTotal, currentFile: null })

    const row = screen.getByRole('listitem', { name: 'photos' })
    expect(row.textContent).toContain('Downloaded to C:\\dl\\photos')
    fireEvent.click(within(row).getByRole('button', { name: 'Show in folder' }))
    expect(window.winraid.local.reveal).toHaveBeenCalledWith('C:\\dl\\photos')

    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.queryByRole('listitem', { name: 'photos' })).toBeNull()
    expect(window.winraid.downloads.dismiss).toHaveBeenCalledWith('j1')
  })

  it('reports a canceled download, then clears it', async () => {
    vi.useFakeTimers()
    const { emit } = mount({ jobs: [RUNNING] })
    await act(async () => {})
    await emit({ ...RUNNING, state: 'canceled', currentFile: null })
    expect(screen.getByRole('listitem', { name: 'photos' }).textContent).toContain('Canceled')
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.queryByRole('listitem', { name: 'photos' })).toBeNull()
  })

  it('keeps a failed download with its reason until dismissed', async () => {
    vi.useFakeTimers()
    const { emit } = mount({ jobs: [RUNNING] })
    await act(async () => {})
    await emit({ ...RUNNING, state: 'failed', error: 'Connection lost', currentFile: null })

    const row = screen.getByRole('listitem', { name: 'photos' })
    expect(within(row).getByRole('alert').textContent).toContain('Connection lost')
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByRole('listitem', { name: 'photos' })).toBeTruthy()

    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))
    expect(window.winraid.downloads.dismiss).toHaveBeenCalledWith('j1')
    expect(screen.queryByRole('listitem', { name: 'photos' })).toBeNull()
  })
})
