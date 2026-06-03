import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import DashboardView from './DashboardView'

const CONNECTIONS = [
  { id: 'conn-1', name: 'Kepler', type: 'sftp', icon: null, sftp: { host: '10.0.0.1', remotePath: '/mnt/data' } },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    remote: {
      diskUsage: vi.fn().mockResolvedValue({ ok: true, total: 10 * 1024 ** 3, used: 4 * 1024 ** 3, free: 6 * 1024 ** 3 }),
    },
  })
})

afterEach(() => { delete window.winraid; vi.restoreAllMocks() })

describe('DashboardView Storage block', () => {
  it('renders the Storage section heading', async () => {
    render(<DashboardView connections={CONNECTIONS} watcherStatus={{}} />)
    await waitFor(() => expect(screen.getByText('Storage')).toBeInTheDocument())
  })

  it('shows used and total disk size for a connection', async () => {
    render(<DashboardView connections={CONNECTIONS} watcherStatus={{}} />)
    await waitFor(() => expect(screen.getByText(/4\.00 GB used/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/10\.00 GB total/)).toBeInTheDocument())
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
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument())
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
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /verify & clean/i })).toBeNull()
  })
})
