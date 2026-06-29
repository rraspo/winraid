import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Header from './Header'
import { createWinraidMock } from '../__mocks__/winraid'

const CONNS = [{ id: 'c1', name: 'Kepler', icon: null }]

const ENTRIES = [
  { id: 1, ts: Date.now(), level: 'info', type: 'move', connectionId: 'c1',
    title: 'Moved photo.jpg', detail: '→ /media/archive',
    nav: { kind: 'remote', path: '/media/archive', highlight: 'photo.jpg' } },
  { id: 2, ts: Date.now(), level: 'error', type: 'upload', connectionId: 'c1',
    title: 'Upload failed', detail: 'Connection refused', nav: null },
]

function renderHeader(props = {}) {
  return render(
    <Header
      watcherStatus={{}}
      activeTransfers={new Set()}
      queuePaused
      onGlobalToggle={() => {}}
      connections={CONNS}
      onNavigate={() => {}}
      {...props}
    />
  )
}

beforeEach(() => {
  window.winraid = createWinraidMock({
    activity: { tail: vi.fn().mockResolvedValue(ENTRIES), onEntry: vi.fn().mockReturnValue(() => {}) },
  })
})
afterEach(() => { delete window.winraid })

describe('Header activity feed', () => {
  it('renders entry titles and the connection pill', async () => {
    renderHeader()
    await waitFor(() => expect(screen.getByText('Moved photo.jpg')).toBeInTheDocument())
    expect(screen.getByText('→ /media/archive')).toBeInTheDocument()
    expect(screen.getAllByText('Kepler').length).toBeGreaterThan(0)
  })

  it('renders a clickable entry as a button and navigates on click', async () => {
    const onActivityNavigate = vi.fn()
    renderHeader({ onActivityNavigate })
    const btn = await screen.findByRole('button', { name: /Moved photo\.jpg/ })
    fireEvent.click(btn)
    expect(onActivityNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('does not render a non-navigable entry as a button', async () => {
    renderHeader()
    await screen.findByText('Upload failed')
    expect(screen.queryByRole('button', { name: /Upload failed/ })).toBeNull()
  })
})
