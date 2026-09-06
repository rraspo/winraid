import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import WhatsNew from './WhatsNew'

// Contract under test — the What's New window on the redesign, after the
// dialog in ref/whats-new.png: the app icon with "What's new in <version>",
// the highlights as a plain list, and a Close action. The highlights and
// the close behavior are unchanged (see WhatsNew.test.jsx).

beforeEach(() => {
  window.winraid = {
    getVersion: vi.fn().mockResolvedValue('3.0.0'),
    whatsNew: { close: vi.fn().mockResolvedValue({ ok: true }) },
  }
})

afterEach(() => {
  cleanup()
  delete window.winraid
})

describe('WhatsNew redesign', () => {
  it('titles the window with the version', async () => {
    render(<WhatsNew />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: "What's new in 3.0.0" })).toBeInTheDocument())
  })

  it('lists the highlights as list items', async () => {
    render(<WhatsNew />)
    const list = await screen.findByRole('list')
    expect(list.querySelectorAll('li').length).toBeGreaterThanOrEqual(3)
  })

  it('closes from a Close action', async () => {
    render(<WhatsNew />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(window.winraid.whatsNew.close).toHaveBeenCalled()
  })
})
