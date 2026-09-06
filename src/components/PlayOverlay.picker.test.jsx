import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import PlayOverlay from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

// Contract under test — the play wall names the connection it is walking
// and can switch it without leaving the wall, the same way the browser
// toolbar does. The nav rail no longer picks one silently.
//
// DOM contract:
//   - the wall header holds the picker (button "Connection: <name>")
//   - choosing another connection calls onSelectConnection(connectionId)

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/photos' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { remotePath: '/docs' } },
]

let savedIntersectionObserver
let savedResizeObserver

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  savedResizeObserver       = window.ResizeObserver
  window.IntersectionObserver     = ObserverStub
  window.ResizeObserver           = ObserverStub
  globalThis.IntersectionObserver = ObserverStub
  globalThis.ResizeObserver       = ObserverStub
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({ recursive: true, shuffle: false }) },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockReturnValue(() => {}),
      onMediaDone:  vi.fn().mockReturnValue(() => {}),
      onMediaError: vi.fn().mockReturnValue(() => {}),
    },
  })
})

afterEach(() => {
  window.IntersectionObserver     = savedIntersectionObserver
  window.ResizeObserver           = savedResizeObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  globalThis.ResizeObserver       = savedResizeObserver
  delete window.winraid
})

describe('PlayOverlay connection picker', () => {
  it('names the connection it is walking and switches on demand', async () => {
    const onSelectConnection = vi.fn()
    render(
      <PlayOverlay
        connectionId="c1"
        path="/photos"
        connections={CONNECTIONS}
        onSelectConnection={onSelectConnection}
        onClose={vi.fn()}
        remoteBasePath="/photos"
        canServerEdit
        onMutated={vi.fn()}
      />,
    )
    await act(async () => {})
    const trigger = screen.getByRole('button', { name: 'Connection: Atlas' })
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Vault/ }))
    expect(onSelectConnection).toHaveBeenCalledWith('c2')
  })
})
