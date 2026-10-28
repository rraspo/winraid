import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import WhatsNew from './WhatsNew'

beforeEach(() => {
  window.winraid = {
    getVersion: vi.fn().mockResolvedValue('2.7.0'),
    whatsNew: { close: vi.fn().mockResolvedValue({ ok: true }) },
  }
})

afterEach(() => {
  cleanup()
  delete window.winraid
})

describe('WhatsNew window', () => {
  it('shows the current version in the heading', async () => {
    render(<WhatsNew />)
    await waitFor(() => expect(screen.getByText(/2\.7\.0/)).toBeInTheDocument())
  })

  it('lists the headline features', async () => {
    render(<WhatsNew />)
    // Representative highlight titles from the 3.1 notes
    expect(await screen.findByText(/Activity remembers/i)).toBeInTheDocument()
    expect(screen.getByText(/Downloads in the background/i)).toBeInTheDocument()
    expect(screen.getByText(/PDFs in Quick Look/i)).toBeInTheDocument()
    expect(screen.getByText(/Trim audio/i)).toBeInTheDocument()
  })

  it('closes the window when "Close" is clicked', async () => {
    render(<WhatsNew />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(window.winraid.whatsNew.close).toHaveBeenCalled()
  })
})
