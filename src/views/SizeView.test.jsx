import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import SizeView from './SizeView'

const CONN = { id: 'conn-1', name: 'Kepler', type: 'sftp', sftp: { host: '10.0.0.1', remotePath: '/mnt/data' } }

beforeEach(() => {
  window.winraid = createWinraidMock()
})
afterEach(() => { delete window.winraid; vi.restoreAllMocks() })

describe('SizeView — idle state', () => {
  it('renders "Scan Now" button', () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    expect(screen.getByRole('button', { name: /scan now/i })).toBeInTheDocument()
  })

  it('shows "Last scan: never" when no data is available', () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    expect(screen.getByText(/last scan: never/i)).toBeInTheDocument()
  })

  it('does not render the chart in idle state', () => {
    const { container } = render(<SizeView connectionId="conn-1" connection={CONN} />)
    expect(container.querySelector('[data-role="center"]')).toBeNull()
  })
})

describe('SizeView — scanning state', () => {
  it('shows "Scanning" heading after Scan Now is clicked', async () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }))
    await waitFor(() => expect(screen.getByText(/scanning/i)).toBeInTheDocument())
  })

  it('shows a Cancel button while scanning', async () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument())
  })

  it('calls remote.sizeCancel when Cancel is clicked', async () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }))
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(window.winraid.remote.sizeCancel).toHaveBeenCalledWith('conn-1')
  })

  it('calls remote.sizeScan when Scan Now is clicked', async () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }))
    await waitFor(() => expect(window.winraid.remote.sizeScan).toHaveBeenCalledWith('conn-1'))
  })
})

describe('SizeView — error handling', () => {
  it('shows error banner when size:error is received', async () => {
    let errorCb
    window.winraid.remote.onSizeError = vi.fn((cb) => { errorCb = cb; return () => {} })
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument())
    act(() => errorCb({ connectionId: 'conn-1', error: 'Permission denied' }))
    await waitFor(() => expect(screen.getByText('Permission denied')).toBeInTheDocument())
  })

  it('resets to idle when connectionId changes', () => {
    const { rerender } = render(<SizeView connectionId="conn-1" connection={CONN} />)
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }))
    rerender(<SizeView connectionId="conn-2" connection={{ ...CONN, id: 'conn-2' }} />)
    expect(screen.getByRole('button', { name: /scan now/i })).toBeInTheDocument()
  })
})

describe('SizeView — results state (via size:done event)', () => {
  it('shows "Re-scan" button once size:done fires', async () => {
    let doneCb
    window.winraid.remote.onSizeDone = vi.fn((cb) => { doneCb = cb; return () => {} })

    render(<SizeView connectionId="conn-1" connection={CONN} />)
    fireEvent.click(screen.getByRole('button', { name: /scan now/i }))
    await waitFor(() => expect(doneCb).toBeDefined())

    act(() => doneCb({ connectionId: 'conn-1', totalFolders: 42, elapsedMs: 5000 }))
    await waitFor(() => expect(screen.getByRole('button', { name: /re-scan/i })).toBeInTheDocument())
  })
})
