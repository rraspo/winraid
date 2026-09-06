import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import QueueView from './QueueView'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const TEST_CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', sftp: { host: '10.0.0.1', remotePath: '/mnt' } },
]

function makeJob(overrides = {}) {
  return {
    id:            'job-1',
    srcPath:       '/local/files/test.mp4',
    filename:      'test.mp4',
    relPath:       'test.mp4',
    size:          1048576,
    status:        'PENDING',
    progress:      0,
    errorMsg:      '',
    connectionId:  'conn-1',
    createdAt:     Date.now(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  window.winraid = createWinraidMock()
})

afterEach(() => {
  delete window.winraid
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('QueueView', () => {
  it('renders empty state when no jobs exist', async () => {
    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('No transfers yet')).toBeInTheDocument()
  })

  it('places a pending job under the Waiting group with its connection and size', async () => {
    window.winraid.queue.list.mockResolvedValue([makeJob()])

    render(<QueueView connections={TEST_CONNECTIONS} />)

    // Wait for data to load
    expect(await screen.findByText('test.mp4')).toBeInTheDocument()

    const waiting = screen.getByRole('region', { name: 'Waiting' })
    expect(waiting.textContent).toContain('test.mp4')
    expect(waiting.textContent).toContain('Atlas')
    expect(waiting.textContent).toContain('1.0 MB')
  })

  it('renders correct status badge for each status', async () => {
    window.winraid.queue.list.mockResolvedValue([
      makeJob({ id: 'j1', filename: 'pending.mp4', status: 'PENDING' }),
      makeJob({ id: 'j2', filename: 'done.mp4', status: 'DONE' }),
      makeJob({ id: 'j3', filename: 'error.mp4', status: 'ERROR', errorMsg: 'connection lost' }),
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)

    expect(await screen.findByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('shows the full nested destination for drop-uploaded folder children', async () => {
    // When you drag a folder into WinRaid, each file is queued with a
    // relPath that includes the dropped folder name as a prefix (e.g.
    // "myFolder/sub/photo.jpg"). The destination shown in the queue must
    // include the relPath's directory portion, not just the bare
    // remoteDest, or it looks like the file went straight into remoteDest
    // with no parent folder.
    window.winraid.queue.list.mockResolvedValue([
      makeJob({
        id: 'j1',
        filename: 'photo.jpg',
        relPath: 'myFolder/sub/photo.jpg',
        remoteDest: '/dest',
      }),
    ])
    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('photo.jpg')).toBeInTheDocument()
    expect(screen.getByText('/dest/myFolder/sub')).toBeInTheDocument()
  })

  it('shows remoteDest + folder name for a file at the root of a dropped folder', async () => {
    window.winraid.queue.list.mockResolvedValue([
      makeJob({
        id: 'j1',
        filename: 'photo.jpg',
        relPath: 'myFolder/photo.jpg',
        remoteDest: '/dest',
      }),
    ])
    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('photo.jpg')).toBeInTheDocument()
    expect(screen.getByText('/dest/myFolder')).toBeInTheDocument()
  })

  it('shows transferring status with percentage', async () => {
    window.winraid.queue.list.mockResolvedValue([
      makeJob({ id: 'j1', status: 'TRANSFERRING', progress: 0.45 }),
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('45%')).toBeInTheDocument()
  })

  it('shows retry and remove buttons only for ERROR jobs', async () => {
    window.winraid.queue.list.mockResolvedValue([
      makeJob({ id: 'j1', filename: 'good.mp4', status: 'DONE' }),
      makeJob({ id: 'j2', filename: 'bad.mp4', status: 'ERROR', errorMsg: 'fail' }),
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    await screen.findByText('good.mp4')

    // Retry and Remove buttons should exist (for error job)
    const retryBtns = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('svg') && btn.className.includes('retry')
    )
    expect(retryBtns.length).toBe(1)
  })

  it('shows cancel button for PENDING and TRANSFERRING jobs', async () => {
    window.winraid.queue.list.mockResolvedValue([
      makeJob({ id: 'j1', status: 'PENDING' }),
      makeJob({ id: 'j2', status: 'TRANSFERRING', progress: 0.5 }),
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    await screen.findByText('Pending')

    const cancelBtns = screen.getAllByRole('button').filter(
      (btn) => btn.className.includes('cancel')
    )
    expect(cancelBtns.length).toBe(2)
  })

  it('shows "Clear N done" button when DONE jobs exist', async () => {
    window.winraid.queue.list.mockResolvedValue([
      makeJob({ id: 'j1', status: 'DONE' }),
      makeJob({ id: 'j2', status: 'DONE' }),
      makeJob({ id: 'j3', status: 'PENDING' }),
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('Clear 2 done')).toBeInTheDocument()
  })

  it('displays file size when available', async () => {
    window.winraid.queue.list.mockResolvedValue([
      makeJob({ size: 2621440 }), // 2.5 MB
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('2.5 MB')).toBeInTheDocument()
  })

  it('displays connection name in tag', async () => {
    window.winraid.queue.list.mockResolvedValue([makeJob()])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('Atlas')).toBeInTheDocument()
  })

})

describe('QueueView converges on store state', () => {
  it('converges a retried job to the refetched status instead of freezing on Error', async () => {
    let updatedCb
    window.winraid.queue.onUpdated = vi.fn((cb) => { updatedCb = cb; return () => {} })
    window.winraid.queue.list = vi.fn()
      .mockResolvedValueOnce([makeJob({ id: 'j1', filename: 'retry.mp4', status: 'ERROR', errorMsg: 'boom' })])
      .mockResolvedValue([makeJob({ id: 'j1', filename: 'retry.mp4', status: 'PENDING' })])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('Error')).toBeInTheDocument()

    act(() => { updatedCb({ type: 'retry', jobId: 'j1' }) })

    expect(await screen.findByText('Pending')).toBeInTheDocument()
  })

  it('converges on an unhandled payload type (e.g. stats) by refetching the list', async () => {
    let updatedCb
    window.winraid.queue.onUpdated = vi.fn((cb) => { updatedCb = cb; return () => {} })
    window.winraid.queue.list = vi.fn()
      .mockResolvedValueOnce([makeJob({ id: 'j1', filename: 'stats.mp4', status: 'PENDING' })])
      .mockResolvedValue([makeJob({ id: 'j1', filename: 'stats.mp4', status: 'TRANSFERRING', progress: 0.2 })])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('Pending')).toBeInTheDocument()

    act(() => { updatedCb({ type: 'stats' }) })

    expect(await screen.findByText('20%')).toBeInTheDocument()
  })

  it('refetches on cleared instead of filtering renderer-local rows by status', async () => {
    let updatedCb
    let progressCb
    window.winraid.queue.onUpdated = vi.fn((cb) => { updatedCb = cb; return () => {} })
    window.winraid.queue.onProgress = vi.fn((cb) => { progressCb = cb; return () => {} })
    window.winraid.queue.list = vi.fn()
      .mockResolvedValueOnce([makeJob({ id: 'j1', filename: 'drift.mp4', status: 'PENDING' })])
      .mockResolvedValue([])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('drift.mp4')).toBeInTheDocument()

    // A progress tick drifts the renderer-local row to TRANSFERRING even though
    // the store has already removed the job by the time 'cleared' arrives.
    act(() => { progressCb({ jobId: 'j1', percent: 50 }) })
    expect(await screen.findByText('50%')).toBeInTheDocument()

    act(() => { updatedCb({ type: 'cleared' }) })

    expect(await screen.findByText('No transfers yet')).toBeInTheDocument()
  })

  it('a progress tick cannot resurrect a terminal ERROR status', async () => {
    let progressCb
    window.winraid.queue.onProgress = vi.fn((cb) => { progressCb = cb; return () => {} })
    window.winraid.queue.list = vi.fn().mockResolvedValue([
      makeJob({ id: 'j1', filename: 'cancelled.mp4', status: 'ERROR', errorMsg: 'Cancelled' }),
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('Error')).toBeInTheDocument()

    act(() => { progressCb({ jobId: 'j1', percent: 90 }) })

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.queryByText('90%')).toBeNull()
  })

  it('a progress tick cannot resurrect a terminal DONE status', async () => {
    let progressCb
    window.winraid.queue.onProgress = vi.fn((cb) => { progressCb = cb; return () => {} })
    window.winraid.queue.list = vi.fn().mockResolvedValue([
      makeJob({ id: 'j1', filename: 'finished.mp4', status: 'DONE' }),
    ])

    render(<QueueView connections={TEST_CONNECTIONS} />)
    expect(await screen.findByText('Done')).toBeInTheDocument()

    act(() => { progressCb({ jobId: 'j1', percent: 90 }) })

    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.queryByText('90%')).toBeNull()
  })
})
