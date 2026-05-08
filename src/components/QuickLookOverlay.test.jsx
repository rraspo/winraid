import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import QuickLookOverlay from './QuickLookOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

// react-image-crop renders a div wrapper; we don't need its full behavior in tests.
vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

beforeEach(() => {
  window.winraid = createWinraidMock()
})

afterEach(() => { delete window.winraid })

const baseProps = {
  connectionId: 'c1',
  remoteBasePath: '/media',
  files: [],
  onNavigate: vi.fn(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
}

const imageFile = { name: 'photo.jpg', path: '/media/photo.jpg', size: 100, modified: 0 }
const audioFile = { name: 'song.mp3',  path: '/media/song.mp3',  size: 100, modified: 0 }
const textFile  = { name: 'note.txt',  path: '/media/note.txt',  size: 100, modified: 0 }

describe('QuickLookOverlay — Crop button', () => {
  it('renders the Crop button for image files', async () => {
    render(<QuickLookOverlay {...baseProps} file={imageFile} />)
    await act(async () => {})
    expect(screen.getByLabelText('Crop image')).toBeInTheDocument()
  })

  it('does not render the Crop button for audio files', async () => {
    render(<QuickLookOverlay {...baseProps} file={audioFile} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Crop image')).not.toBeInTheDocument()
  })

  it('does not render the Crop button for text files', async () => {
    render(<QuickLookOverlay {...baseProps} file={textFile} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Crop image')).not.toBeInTheDocument()
  })

  it('enters inline crop mode when Crop is clicked, hides Crop button, shows aspect controls and Cancel', async () => {
    render(<QuickLookOverlay {...baseProps} file={imageFile} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Crop image'))
    expect(screen.queryByLabelText('Crop image')).not.toBeInTheDocument()
    expect(screen.getByText('Aspect')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Save copy')).toBeInTheDocument()
    expect(screen.getByText('Overwrite')).toBeInTheDocument()
    expect(screen.getByTestId('react-crop')).toBeInTheDocument()
  })

  it('exits crop mode when Cancel is clicked', async () => {
    render(<QuickLookOverlay {...baseProps} file={imageFile} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Crop image'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.getByLabelText('Crop image')).toBeInTheDocument()
    expect(screen.queryByText('Aspect')).not.toBeInTheDocument()
  })

  it('disables Prev/Next buttons while cropping', async () => {
    const files = [
      { name: 'a.jpg', path: '/media/a.jpg', size: 100, modified: 0 },
      { name: 'b.jpg', path: '/media/b.jpg', size: 100, modified: 0 },
    ]
    render(<QuickLookOverlay {...baseProps} files={files} file={files[0]} />)
    await act(async () => {})
    expect(screen.getByLabelText('Next file')).not.toBeDisabled()
    fireEvent.click(screen.getByLabelText('Crop image'))
    expect(screen.getByLabelText('Next file')).toBeDisabled()
    expect(screen.getByLabelText('Previous file')).toBeDisabled()
  })

  it('renders the Snapshot button only for video files', async () => {
    const videoFile = { name: 'clip.mp4', path: '/media/clip.mp4', size: 100, modified: 0 }
    const { unmount } = render(<QuickLookOverlay {...baseProps} file={videoFile} />)
    await act(async () => {})
    expect(screen.getByLabelText('Save video snapshot')).toBeInTheDocument()
    unmount()

    render(<QuickLookOverlay {...baseProps} file={imageFile} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Save video snapshot')).not.toBeInTheDocument()
  })

  it('Escape exits crop mode rather than closing the overlay', async () => {
    const onClose = vi.fn()
    render(<QuickLookOverlay {...baseProps} file={imageFile} onClose={onClose} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Crop image'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Aspect')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
