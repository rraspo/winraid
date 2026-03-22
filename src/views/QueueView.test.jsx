import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import QueueView from './QueueView'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const TEST_CONNECTIONS = [
  { id: 'conn-1', name: 'Kepler', sftp: { host: '10.0.0.1', remotePath: '/mnt' } },
]

function makeJob(overrides = {}) {
  return {
    id: overrides.id ?? 'job-1',
    srcPath: '/local/files/test.mp4',
    filename: overrides.filename ?? 'test.mp4',
    relPath: 'test.mp4',
    size: overrides.size ?? 1048576,
    status: overrides.status ?? 'PENDING',
    progress: overrides.progress ?? 0,
    errorMsg: overrides.errorMsg ?? '',
    connectionId: overrides.connectionId ?? 'conn-1',
    createdAt: overrides.createdAt ?? Date.now(),
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

  it('renders all column headers when jobs exist', async () => {
    window.winraid.queue.list.mockResolvedValue([makeJob()])

    render(<QueueView connections={TEST_CONNECTIONS} />)

    // Wait for data to load
    expect(await screen.findByText('test.mp4')).toBeInTheDocument()

    // All headers should be present
    expect(screen.getByText('File / Path')).toBeInTheDocument()
    expect(screen.getByText('Connection')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Size')).toBeInTheDocument()
    expect(screen.getByText('Added')).toBeInTheDocument()
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
    expect(await screen.findByText('Kepler')).toBeInTheDocument()
  })

  it('file column uses flex:1 and minWidth:0 (no magic numbers)', async () => {
    window.winraid.queue.list.mockResolvedValue([makeJob()])

    const { container } = render(<QueueView connections={TEST_CONNECTIONS} />)
    await screen.findByText('test.mp4')

    // Find the header row
    const colHeader = container.querySelector('.colHeader')
    expect(colHeader).toBeInTheDocument()

    // The file column header cell should have flex and a small minWidth
    // React sets inline style as an attribute string
    const headerCells = Array.from(colHeader.querySelectorAll('[class*="colHeaderCell"]'))
    const fileHeaderCell = headerCells.find((cell) => {
      const styleAttr = cell.getAttribute('style') ?? ''
      return styleAttr.includes('flex') && styleAttr.includes('min-width')
    })
    expect(fileHeaderCell).toBeTruthy()

    // Guard against magic numbers: minWidth must be 0, not a large value like 999
    const styleAttr = fileHeaderCell.getAttribute('style')
    const minWidthMatch = styleAttr.match(/min-width:\s*(\d+)/)
    const minWidthValue = minWidthMatch ? parseInt(minWidthMatch[1], 10) : 0
    expect(minWidthValue).toBe(0)
  })
})
