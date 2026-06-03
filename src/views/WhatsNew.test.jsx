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
    // Representative highlight titles from the 2.7.0 notes
    expect(await screen.findByText(/Sort your files/i)).toBeInTheDocument()
    expect(screen.getByText(/Search and jump/i)).toBeInTheDocument()
    expect(screen.getByText(/Ignored extensions/i)).toBeInTheDocument()
    expect(screen.getByText(/Smarter rename/i)).toBeInTheDocument()
  })

  it('closes the window when "Got it" is clicked', async () => {
    render(<WhatsNew />)
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    expect(window.winraid.whatsNew.close).toHaveBeenCalled()
  })
})
