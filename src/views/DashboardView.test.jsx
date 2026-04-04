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
