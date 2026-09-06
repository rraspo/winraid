import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import DashboardView from './DashboardView'

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', icon: null, sftp: { host: '10.0.0.1', remotePath: '/mnt/data' } },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    remote: {
      diskUsage: vi.fn().mockResolvedValue({ ok: true, total: 10 * 1024 ** 3, used: 4 * 1024 ** 3, free: 6 * 1024 ** 3 }),
    },
  })
})

afterEach(() => { delete window.winraid; vi.restoreAllMocks() })

describe('DashboardView disk usage', () => {
  it('shows used of total disk size inside the connection card', async () => {
    render(<DashboardView connections={CONNECTIONS} watcherStatus={{}} />)
    const card = screen.getByRole('article', { name: 'Atlas' })
    await waitFor(() => expect(card.textContent).toContain('4.00 GB of 10.00 GB'))
  })

  it('shows unavailable message when diskUsage returns ok: false', async () => {
    window.winraid.remote.diskUsage = vi.fn().mockResolvedValue({ ok: false, error: 'Not supported' })
    render(<DashboardView connections={CONNECTIONS} watcherStatus={{}} />)
    await waitFor(() => expect(screen.getByText(/unavailable/i)).toBeInTheDocument())
  })
})

describe('DashboardView Completed stat + Verify & clean', () => {
  it('shows the lifetime completed count from queue.stats before the In queue stat', async () => {
    window.winraid.queue.stats = vi.fn().mockResolvedValue({ lifetimeCompleted: 128 })
    render(<DashboardView connections={CONNECTIONS} watcherStatus={{}} />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Files synced' })).toBeInTheDocument())
    expect(screen.getByText('128')).toBeInTheDocument()
  })

  it('renders a Verify & clean action', async () => {
    render(<DashboardView connections={CONNECTIONS} watcherStatus={{}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /verify & clean/i })).toBeInTheDocument())
  })

  it('opens the connection editor when Verify & clean is clicked', async () => {
    const onEditConnection = vi.fn()
    render(
      <DashboardView connections={CONNECTIONS} watcherStatus={{}} onEditConnection={onEditConnection} />
    )
    const btn = await screen.findByRole('button', { name: /verify & clean/i })
    btn.click()
    expect(onEditConnection).toHaveBeenCalledWith(CONNECTIONS[0])
  })

  it('does not render Verify & clean when there are no connections', async () => {
    render(<DashboardView connections={[]} watcherStatus={{}} />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Files synced' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /verify & clean/i })).toBeNull()
  })
})

describe('DashboardView progress guard', () => {
  it('a progress tick cannot resurrect a terminal status back into the active transfer list', async () => {
    let progressCb
    window.winraid.queue.list = vi.fn().mockResolvedValue([
      { id: 'j1', filename: 'done.mp4', status: 'DONE', progress: 1, srcPath: '/local/done.mp4' },
    ])
    window.winraid.queue.onProgress = vi.fn((cb) => { progressCb = cb; return () => {} })

    render(<DashboardView connections={CONNECTIONS} watcherStatus={{}} />)
    await waitFor(() => expect(screen.getByText('Queue is empty')).toBeInTheDocument())

    act(() => { progressCb({ jobId: 'j1', percent: 77 }) })

    expect(screen.getByText('Queue is empty')).toBeInTheDocument()
    expect(screen.queryByText('77% complete')).toBeNull()
  })
})
