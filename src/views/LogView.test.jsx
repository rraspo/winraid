import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import LogView from './LogView'

const ENTRIES = [
  { level: 'info',  message: 'Transfer started: foo.mp4',          ts: 1000 },
  { level: 'error', message: 'Failed: foo.mp4 [nas] src=C:\\foo.mp4 → /data/foo.mp4 — No such file', ts: 2000 },
  { level: 'info',  message: 'Transfer started: bar.mkv',           ts: 3000 },
]

beforeEach(() => {
  window.winraid = {
    log: {
      tail:    vi.fn().mockResolvedValue(ENTRIES),
      onEntry: vi.fn().mockReturnValue(() => {}),
      reveal:  vi.fn(),
      clear:   vi.fn(),
    },
  }
})

describe('search filter', () => {
  it('shows all entries when filter is empty', async () => {
    render(<LogView />)
    await waitFor(() => screen.getAllByText(/foo\.mp4/))
    expect(screen.getAllByText(/mp4|mkv/).length).toBeGreaterThan(0)
    expect(screen.getByText(/bar\.mkv/)).toBeInTheDocument()
  })

  it('hides entries that do not match the filter', async () => {
    render(<LogView />)
    await waitFor(() => screen.getAllByText(/foo\.mp4/))
    fireEvent.change(screen.getByPlaceholderText('Filter logs…'), { target: { value: 'foo.mp4' } })
    expect(screen.getAllByText(/foo\.mp4/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/bar\.mkv/)).not.toBeInTheDocument()
  })

  it('is case-insensitive', async () => {
    render(<LogView />)
    await waitFor(() => screen.getByText(/bar\.mkv/))
    fireEvent.change(screen.getByPlaceholderText('Filter logs…'), { target: { value: 'BAR.MKV' } })
    expect(screen.getByText(/bar\.mkv/)).toBeInTheDocument()
    expect(screen.queryByText(/foo\.mp4/)).not.toBeInTheDocument()
  })
})

describe('logNav', () => {
  it('pre-fills filter with filename from logNav', async () => {
    render(<LogView logNav={{ filename: 'foo.mp4', errorAt: 2000 }} />)
    await waitFor(() => screen.getAllByText(/foo\.mp4/))
    expect(screen.getByPlaceholderText('Filter logs…')).toHaveValue('foo.mp4')
    expect(screen.queryByText(/bar\.mkv/)).not.toBeInTheDocument()
  })

  it('updates filter when logNav prop changes', async () => {
    const { rerender } = render(<LogView logNav={null} />)
    await waitFor(() => screen.getByText(/bar\.mkv/))
    rerender(<LogView logNav={{ filename: 'bar.mkv', errorAt: 3000 }} />)
    await waitFor(() => expect(screen.getByPlaceholderText('Filter logs…')).toHaveValue('bar.mkv'))
    expect(screen.queryByText(/foo\.mp4/)).not.toBeInTheDocument()
  })
})
