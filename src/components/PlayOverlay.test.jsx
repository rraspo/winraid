import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import PlayOverlay from './PlayOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

let onMediaFoundCb = null
let onMediaDoneCb  = null
let onMediaErrorCb = null

function setup() {
  onMediaFoundCb = null
  onMediaDoneCb  = null
  onMediaErrorCb = null
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({ recursive: true, shuffle: true }) },
    remote: {
      mediaScan:    vi.fn().mockResolvedValue({ ok: true }),
      mediaCancel:  vi.fn().mockResolvedValue({ ok: true }),
      onMediaFound: vi.fn().mockImplementation((cb) => { onMediaFoundCb = cb; return () => {} }),
      onMediaDone:  vi.fn().mockImplementation((cb) => { onMediaDoneCb  = cb; return () => {} }),
      onMediaError: vi.fn().mockImplementation((cb) => { onMediaErrorCb = cb; return () => {} }),
    },
  })
}

afterEach(() => { delete window.winraid })

const defaultProps = { connectionId: 'c1', path: '/photos', onClose: vi.fn() }

describe('PlayOverlay', () => {
  it('renders the overlay element', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('renders the first file immediately when first onMediaFound fires', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [{ path: '/photos/a.jpg', size: 100, mtime: 0, type: 'image' }] })
    })
    expect(screen.getByRole('img')).toBeTruthy()
  })

  it('shows scanning indicator while scanning', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    expect(screen.getByLabelText('Scanning')).toBeTruthy()
    act(() => { onMediaDoneCb?.({ totalMatches: 0, durationMs: 10 }) })
    expect(screen.queryByLabelText('Scanning')).toBeNull()
  })

  it('shows empty state when scan completes with no files', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    act(() => { onMediaDoneCb?.({ totalMatches: 0, durationMs: 10 }) })
    expect(screen.getByText('No media files found')).toBeTruthy()
  })

  it('navigates forward and backward with ArrowRight and ArrowLeft', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/photos/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/photos/b.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    const img = () => screen.getByRole('img')
    expect(img().src).toContain('a.jpg')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(img().src).toContain('b.jpg')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(img().src).toContain('a.jpg')
  })

  it('shows end-of-list indicator at last file when scan is done', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [{ path: '/photos/a.jpg', size: 0, mtime: 0, type: 'image' }] })
      onMediaDoneCb?.({ totalMatches: 1, durationMs: 10 })
    })
    expect(screen.getByText('End')).toBeTruthy()
  })

  it('calls onClose when close button is clicked', async () => {
    setup()
    const onClose = vi.fn()
    render(<PlayOverlay {...defaultProps} onClose={onClose} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders recursive and shuffle toggle buttons', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    expect(screen.getByLabelText('Toggle recursive scan')).toBeTruthy()
    expect(screen.getByLabelText('Toggle shuffle')).toBeTruthy()
  })

  it('shows error message and Retry button when fatal error fires', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    act(() => {
      onMediaErrorCb?.({ path: '/photos', msg: 'Connection lost', code: 'ECONNRESET' })
    })
    expect(screen.getByText('Connection lost')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('clicking Retry triggers a new mediaScan', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    act(() => {
      onMediaErrorCb?.({ path: '/photos', msg: 'Connection lost', code: 'ECONNRESET' })
    })
    const initialCallCount = window.winraid.remote.mediaScan.mock.calls.length
    fireEvent.click(screen.getByText('Retry'))
    await act(async () => {})
    expect(window.winraid.remote.mediaScan.mock.calls.length).toBeGreaterThan(initialCallCount)
  })

  it('Escape key calls onClose', async () => {
    setup()
    const onClose = vi.fn()
    render(<PlayOverlay {...defaultProps} onClose={onClose} />)
    await act(async () => {})
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('navigates forward on wheel down and backward on wheel up', async () => {
    setup()
    render(<PlayOverlay {...defaultProps} />)
    await act(async () => {})
    act(() => {
      onMediaFoundCb?.({ files: [
        { path: '/photos/a.jpg', size: 0, mtime: 0, type: 'image' },
        { path: '/photos/b.jpg', size: 0, mtime: 0, type: 'image' },
      ] })
    })
    const img = () => screen.getByRole('img')
    expect(img().src).toContain('a.jpg')
    fireEvent.wheel(window, { deltaY: 100 })
    expect(img().src).toContain('b.jpg')
    fireEvent.wheel(window, { deltaY: -100 })
    expect(img().src).toContain('a.jpg')
  })
})
