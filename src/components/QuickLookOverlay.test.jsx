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
  // Enter trim mode with a known duration so the track can map position->time.
  // Entry is async: ffmpeg availability is probed before selection is enabled.
  async function enterTrim(duration = 12) {
    renderOverlay()
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: duration })
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    return video
  }

  it('shows draggable in/out handles and no manual Set buttons', async () => {
    await enterTrim()
    expect(screen.getByRole('slider', { name: 'Trim start' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Trim end' })).toBeInTheDocument()
    expect(screen.getByTestId('trim-in')).toBeInTheDocument()
    expect(screen.getByTestId('trim-out')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Set start')).toBeNull()
    expect(screen.queryByLabelText('Set end')).toBeNull()
  })

  it('defaults the in-point to 0 and the out-point to the full duration', async () => {
    await enterTrim(12)
    expect(screen.getByTestId('trim-in').textContent).toContain('00:00')
    expect(screen.getByTestId('trim-out').textContent).toContain('00:12')
  })

  it('dragging the end handle updates the out-point from the pointer position', async () => {
    await enterTrim(100)
    const track = screen.getByTestId('trim-track')
    track.getBoundingClientRect = () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 6, height: 6, x: 0, y: 0 })
    const endHandle = screen.getByRole('slider', { name: 'Trim end' })
    fireEvent.pointerDown(endHandle, { pointerId: 1, clientX: 200 })
    fireEvent.pointerMove(endHandle, { pointerId: 1, clientX: 100 }) // 50% of 200px -> 50s of 100s
    fireEvent.pointerUp(endHandle, { pointerId: 1, clientX: 100 })
    expect(screen.getByTestId('trim-out').textContent).toContain('00:50')
  })

  it('adjusts a handle with arrow keys for keyboard accessibility', async () => {
    await enterTrim(100) // out defaults to 100s (01:40)
    const endHandle = screen.getByRole('slider', { name: 'Trim end' })
    fireEvent.keyDown(endHandle, { key: 'ArrowLeft' })
    expect(screen.getByTestId('trim-out').textContent).toContain('01:39')
  })

  it('renders one timeline below the video instead of a second slider in the header', async () => {
    const video = await enterTrim()
    const bar = screen.getByTestId('trim-bar')
    expect(bar.contains(screen.getByTestId('trim-track'))).toBe(true)
    // The bar follows the video in document order (sits under it, not in the header)
    expect(video.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(video.parentElement.contains(bar)).toBe(true)
  })

  it('hides the native video controls while trimming and restores them on cancel', async () => {
    const video = await enterTrim()
    expect(video.controls).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(video.controls).toBe(true)
  })
})

describe('QuickLookOverlay trim engine gate', () => {
  it('checks capability on the Trim click and enters when the NAS has ffmpeg', async () => {
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    expect(window.winraid.remote.trimCapability).toHaveBeenCalledWith('c1')
    expect(screen.getByRole('slider', { name: 'Trim start' })).toBeInTheDocument()
  })

  it('offers the local-trim choice when only this PC has ffmpeg, and remembers it', async () => {
    window.winraid = createWinraidMock({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'local' }) },
    })
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    // Dialog first, not straight into selection
    expect(screen.queryByRole('slider', { name: 'Trim start' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Trim locally' }))
    expect(screen.getByRole('slider', { name: 'Trim start' })).toBeInTheDocument()
    // Leave trim mode, re-enter: choice is remembered, no dialog
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    expect(screen.queryByTestId('trim-setup-modal')).toBeNull()
    expect(screen.getByRole('slider', { name: 'Trim start' })).toBeInTheDocument()
  })

  it('offers download/locate but no local-trim choice when no engine exists', async () => {
    window.winraid = createWinraidMock({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'none' }) },
    })
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    expect(screen.queryByRole('slider', { name: 'Trim start' })).toBeNull()
    expect(screen.getByTestId('trim-setup-modal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Locate on this PC/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trim locally' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('trim-setup-modal')).toBeNull()
  })

  it('downloading from the prompt enters trim mode once ffmpeg is ready', async () => {
    window.winraid = createWinraidMock({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'none' }) },
    })
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    await act(async () => {})
    expect(window.winraid.remote.downloadFfmpeg).toHaveBeenCalled()
    expect(screen.queryByTestId('trim-setup-modal')).toBeNull()
    expect(screen.getByRole('slider', { name: 'Trim start' })).toBeInTheDocument()
  })

  it('locating an ffmpeg enters trim mode, and canceling the picker keeps the prompt', async () => {
    window.winraid = createWinraidMock({
      remote: {
        trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'none' }),
        locateFfmpeg: vi.fn()
          .mockResolvedValueOnce({ ok: true, canceled: true })
          .mockResolvedValueOnce({ ok: true, path: 'C:/tools/ffmpeg.exe' }),
      },
    })
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Locate on this PC/ }))
    await act(async () => {})
    expect(screen.getByTestId('trim-setup-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Locate on this PC/ }))
    await act(async () => {})
    expect(screen.queryByTestId('trim-setup-modal')).toBeNull()
    expect(screen.getByRole('slider', { name: 'Trim start' })).toBeInTheDocument()
  })

  it('drops the zoom cursor while trimming', async () => {
    renderOverlay()
    const area = document.querySelector('[class*="previewArea"]')
    expect(area.className).toMatch(/previewAreaZoom/)
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    expect(area.className).not.toMatch(/previewAreaZoom/)
    expect(area.className).not.toMatch(/previewAreaScroll/)
  })

  it('styles the primary and secondary choices distinctly when no engine exists', async () => {
    window.winraid = createWinraidMock({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'none' }) },
    })
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    const download = screen.getByRole('button', { name: /Download/ })
    const locate   = screen.getByRole('button', { name: /Locate on this PC/ })
    const cancel   = screen.getByRole('button', { name: 'Cancel' })
    // Downloading is the primary path here: accent, never the destructive red
    expect(download.className).toMatch(/modalConfirmAccent/)
    // A real action must not look like a dismissal
    expect(locate.className).toMatch(/modalSecondary/)
    expect(cancel.className).toMatch(/modalCancel/)
    expect(locate.className).not.toBe(cancel.className)
  })

  it('styles Trim locally as the accent primary and never uses the destructive red', async () => {
    window.winraid = createWinraidMock({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'local' }) },
    })
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Trim locally' }).className).toMatch(/modalConfirmAccent/)
    expect(screen.getByRole('button', { name: /Download/ }).className).toMatch(/modalSecondary/)
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.className).not.toMatch(/modalConfirm(?!Accent)/)
    }
  })

})

describe('QuickLookOverlay trim playback preview', () => {
  async function enterTrimWithMedia(duration = 100) {
    renderOverlay()
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: duration })
    video.play  = vi.fn(() => { video._paused = false })
    video.pause = vi.fn(() => { video._paused = true })
    Object.defineProperty(video, 'paused', { configurable: true, get: () => video._paused !== false })
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    return video
  }

  it('shows a playhead on the trim track', async () => {
    await enterTrimWithMedia()
    expect(screen.getByTestId('trim-playhead')).toBeInTheDocument()
  })

  it('dragging the bare track scrubs the playhead without moving the handles', async () => {
    const video = await enterTrimWithMedia(100)
    const track = screen.getByTestId('trim-track')
    track.getBoundingClientRect = () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 6, height: 6, x: 0, y: 0 })
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 150 })
    expect(video.currentTime).toBe(75)
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 180 })
    expect(video.currentTime).toBe(90)
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 180 })
    // Selection is untouched: scrubbing only moves the play index
    expect(screen.getByTestId('trim-in').textContent).toContain('00:00')
    expect(screen.getByTestId('trim-out').textContent).toContain('01:40')
  })

  it('play button starts the preview from the in-point', async () => {
    const video = await enterTrimWithMedia(100)
    // Move the in-point to 25s, then play: preview must start at the in-point
    const track = screen.getByTestId('trim-track')
    track.getBoundingClientRect = () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 6, height: 6, x: 0, y: 0 })
    const startHandle = screen.getByRole('slider', { name: 'Trim start' })
    fireEvent.pointerDown(startHandle, { pointerId: 1, clientX: 0 })
    fireEvent.pointerMove(startHandle, { pointerId: 1, clientX: 50 }) // 25% of 200px -> 25s
    fireEvent.pointerUp(startHandle, { pointerId: 1, clientX: 50 })
    video.currentTime = 0
    fireEvent.click(screen.getByRole('button', { name: 'Play selection' }))
    expect(video.currentTime).toBe(25)
    expect(video.play).toHaveBeenCalled()
  })

  it('pauses the preview when playback reaches the out-point', async () => {
    const video = await enterTrimWithMedia(100)
    const track = screen.getByTestId('trim-track')
    track.getBoundingClientRect = () => ({ left: 0, width: 200, right: 200, top: 0, bottom: 6, height: 6, x: 0, y: 0 })
    const endHandle = screen.getByRole('slider', { name: 'Trim end' })
    fireEvent.pointerDown(endHandle, { pointerId: 1, clientX: 200 })
    fireEvent.pointerMove(endHandle, { pointerId: 1, clientX: 100 }) // out = 50s
    fireEvent.pointerUp(endHandle, { pointerId: 1, clientX: 100 })
    fireEvent.click(screen.getByRole('button', { name: 'Play selection' }))
    video.currentTime = 51
    fireEvent.timeUpdate(video)
    expect(video.pause).toHaveBeenCalled()
  })

  it('space toggles play/pause while trimming instead of being locked', async () => {
    const video = await enterTrimWithMedia(100)
    fireEvent.keyDown(window, { key: ' ' })
    expect(video.play).toHaveBeenCalled()
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
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 12 })
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(trimVideo).toHaveBeenCalled())
    expect(trimVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/v/clip.mp4', outPath: '/v/clip_trimmed.mp4', start: 0, end: 12,
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
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 8 })
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(trimVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/v/clip.mp4', outPath: '/v/clip.mp4', start: 0, end: 8,
    })))
  })
})
