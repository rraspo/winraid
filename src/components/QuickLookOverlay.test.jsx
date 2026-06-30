import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import * as remoteFS from '../services/remoteFS'
import QuickLookOverlay from './QuickLookOverlay'

// react-image-crop renders a div wrapper; we don't need its full behavior in tests.
vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

beforeEach(() => {
  window.winraid = createWinraidMock()
})

afterEach(() => { cleanup(); remoteFS.clearAll?.(); delete window.winraid })

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

describe('QuickLookOverlay — Snapshot encoding', () => {
  const videoFile = { name: 'clip.mp4', path: '/media/clip.mp4', size: 100, modified: 0 }

  // Replace document.createElement so canvas.toBlob is observable, while
  // letting other elements (divs, buttons) render normally.
  let canvasMock, origCreateElement

  beforeEach(() => {
    canvasMock = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((cb, mime) => cb(new Blob(['x'], { type: mime ?? 'image/png' }))),
    }
    origCreateElement = document.createElement.bind(document)
    document.createElement = (tag) =>
      tag === 'canvas' ? canvasMock : origCreateElement(tag)
  })

  afterEach(() => {
    document.createElement = origCreateElement
  })

  // Helper: render the overlay with a video file, attach a fake video element
  // to mediaRef so handleSnapshot finds a non-zero videoWidth/videoHeight,
  // and click the snapshot button.
  async function renderAndSnapshot({ formatConfigValue }) {
    window.winraid = createWinraidMock({
      config: {
        get: vi.fn().mockImplementation((key) => {
          if (key === 'snapshot.format') return Promise.resolve(formatConfigValue)
          return Promise.resolve({})
        }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      remote: {
        list:            vi.fn().mockResolvedValue({ ok: true, entries: [] }),
        writeFileBinary: vi.fn().mockResolvedValue({ ok: true }),
      },
    })

    const { container } = render(<QuickLookOverlay {...baseProps} file={videoFile} />)
    await act(async () => {})

    // Stub the video element so captureVideoFrame proceeds.
    const videos = container.querySelectorAll('video')
    expect(videos.length).toBe(1)
    Object.defineProperty(videos[0], 'videoWidth',  { value: 1920, configurable: true })
    Object.defineProperty(videos[0], 'videoHeight', { value: 1080, configurable: true })
    Object.defineProperty(videos[0], 'currentTime', { value: 5,    configurable: true })

    fireEvent.click(screen.getByLabelText('Save video snapshot'))
    await act(async () => {})
  }

  it('encodes as image/jpeg with quality 0.92 and saves with .jpg extension when format is "jpeg"', async () => {
    await renderAndSnapshot({ formatConfigValue: 'jpeg' })
    expect(canvasMock.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
    const writeCall = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(writeCall[1]).toMatch(/\.jpg$/)
  })

  it('encodes as image/png with undefined quality and saves with .png extension when format is "png"', async () => {
    await renderAndSnapshot({ formatConfigValue: 'png' })
    expect(canvasMock.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined)
    const writeCall = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(writeCall[1]).toMatch(/\.png$/)
  })

  it('encodes as image/webp with quality 0.92 and saves with .webp extension when format is "webp"', async () => {
    await renderAndSnapshot({ formatConfigValue: 'webp' })
    expect(canvasMock.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92)
    const writeCall = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(writeCall[1]).toMatch(/\.webp$/)
  })

  it('falls back to JPEG when config returns undefined', async () => {
    await renderAndSnapshot({ formatConfigValue: undefined })
    expect(canvasMock.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
    const writeCall = window.winraid.remote.writeFileBinary.mock.calls[0]
    expect(writeCall[1]).toMatch(/\.jpg$/)
  })

  it('falls back to JPEG when config returns an unknown format', async () => {
    await renderAndSnapshot({ formatConfigValue: 'tiff' })
    expect(canvasMock.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
  })
})

const videoFile = { name: 'clip.mp4', path: '/v/clip.mp4', size: 1000, modified: Date.now(), type: 'file' }

function renderOverlay(props = {}) {
  return render(
    <QuickLookOverlay
      file={videoFile} connectionId="c1" remoteBasePath="/v" files={[videoFile]}
      onNavigate={() => {}} onClose={() => {}} onDelete={() => {}}
      canServerEdit={true} {...props}
    />
  )
}

describe('QuickLookOverlay trim icon', () => {
  it('shows the Trim icon for an SFTP video', () => {
    renderOverlay()
    expect(screen.getByLabelText('Trim video')).toBeInTheDocument()
  })

  it('hides the Trim icon when the connection cannot server-edit (SMB)', () => {
    renderOverlay({ canServerEdit: false })
    expect(screen.queryByLabelText('Trim video')).toBeNull()
  })
})

describe('QuickLookOverlay trim toolbar', () => {
  it('enters trim mode and shows the in/out toolbar', () => {
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    expect(screen.getByLabelText('Set start')).toBeInTheDocument()
    expect(screen.getByLabelText('Set end')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('Set start captures the current playback time as the in-point', () => {
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    const video = document.querySelector('video')
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 5 })
    fireEvent.click(screen.getByLabelText('Set start'))
    expect(screen.getByTestId('trim-in').textContent).toContain('00:05')
  })
})

describe('QuickLookOverlay trim save', () => {
  it('calls trimVideo with a _trimmed dest for Save as new', async () => {
    const trimVideo = vi.fn().mockResolvedValue({ ok: true, outPath: '/v/clip_trimmed.mp4' })
    window.winraid = createWinraidMock({
      remote: {
        list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'clip.mp4', type: 'file' }] }),
        trimVideo,
      },
    })
    render(
      <QuickLookOverlay
        file={videoFile} connectionId="c1" remoteBasePath="/v" files={[videoFile]}
        onNavigate={() => {}} onClose={() => {}} onDelete={() => {}} canServerEdit
      />
    )
    fireEvent.click(screen.getByLabelText('Trim video'))
    const video = document.querySelector('video')
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 4 })
    fireEvent.click(screen.getByLabelText('Set end'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(trimVideo).toHaveBeenCalled())
    expect(trimVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/v/clip.mp4', outPath: '/v/clip_trimmed.mp4', start: 0, end: 4,
    }))
  })

  it('passes the original path as outPath for Overwrite', async () => {
    const trimVideo = vi.fn().mockResolvedValue({ ok: true, outPath: '/v/clip.mp4' })
    window.winraid = createWinraidMock({ remote: { trimVideo } })
    render(
      <QuickLookOverlay
        file={videoFile} connectionId="c1" remoteBasePath="/v" files={[videoFile]}
        onNavigate={() => {}} onClose={() => {}} onDelete={() => {}} canServerEdit
      />
    )
    fireEvent.click(screen.getByLabelText('Trim video'))
    const video = document.querySelector('video')
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 3 })
    fireEvent.click(screen.getByLabelText('Set end'))
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(trimVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/v/clip.mp4', outPath: '/v/clip.mp4',
    })))
  })
})
