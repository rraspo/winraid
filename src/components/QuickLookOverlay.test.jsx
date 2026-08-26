import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'
import QuickLookOverlay from './QuickLookOverlay'

// react-image-crop renders a div wrapper; we don't need its full behavior in
// tests. Clicking the wrapper simulates the user finishing a drag: it fires
// onComplete with a fixed CSS-pixel selection.
vi.mock('react-image-crop', () => ({
  default: ({ children, onComplete }) => (
    <div data-testid="react-crop" onClick={() => onComplete?.({ unit: 'px', x: 10, y: 10, width: 100, height: 50 })}>
      {children}
    </div>
  ),
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

  it('offers Cancel while downloading, which aborts and returns to the intact prompt', async () => {
    let resolveDownload
    window.winraid = createWinraidMock({
      remote: {
        trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'local' }),
        downloadFfmpeg: vi.fn(() => new Promise((resolve) => { resolveDownload = resolve })),
        cancelFfmpegDownload: vi.fn().mockResolvedValue({ ok: true }),
      },
    })
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Download/ }))
    await act(async () => {})
    // Downloading phase: progress plus a way out
    expect(screen.getByText(/Downloading ffmpeg/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(window.winraid.remote.cancelFfmpegDownload).toHaveBeenCalled()
    await act(async () => { resolveDownload({ ok: false, canceled: true }) })
    // Back at the prompt with the local-trim choice intact — no error banner, no trim mode
    expect(screen.getByTestId('trim-setup-modal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trim locally' })).toBeInTheDocument()
    expect(document.querySelector('[class*="modalWarning"]')).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Trim start' })).toBeNull()
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

  // The exact cut can degrade to a keyframe-snapped one (no encoder for the
  // codec, a stream MPEG-TS cannot carry). The toast must not imply precision
  // the file does not have.
  async function saveTrimWith(result) {
    window.winraid = createWinraidMock({
      remote: {
        list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'clip.mp4', type: 'file' }] }),
        trimVideo: vi.fn().mockResolvedValue(result),
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
  }

  it('says so when the cut could not start on the chosen frame', async () => {
    const show = vi.spyOn(toast, 'show')
    await saveTrimWith({ ok: true, outPath: '/v/clip_trimmed.mp4', exact: false })
    await waitFor(() => expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringMatching(/cut moved to the nearest keyframe/i), type: 'success' })
    ))
  })

  it('reports a plain success when the cut landed on the chosen frame', async () => {
    const show = vi.spyOn(toast, 'show')
    await saveTrimWith({ ok: true, outPath: '/v/clip_trimmed.mp4', exact: true })
    await waitFor(() => expect(show).toHaveBeenCalledWith({ msg: 'Trimmed clip saved', type: 'success' }))
  })
})

describe('QuickLookOverlay rotate icon', () => {
  it('shows the Rotate icon for an SFTP video', () => {
    renderOverlay()
    expect(screen.getByLabelText('Rotate video')).toBeInTheDocument()
  })

  it('hides the Rotate icon when the connection cannot server-edit (SMB)', () => {
    renderOverlay({ canServerEdit: false })
    expect(screen.queryByLabelText('Rotate video')).toBeNull()
  })

  it('hides the Rotate icon for containers without rotation metadata (mkv)', () => {
    const mkvFile = { name: 'clip.mkv', path: '/v/clip.mkv', size: 1000, modified: 0, type: 'file' }
    renderOverlay({ file: mkvFile, files: [mkvFile] })
    expect(screen.queryByLabelText('Rotate video')).toBeNull()
  })

  it('hides the Rotate icon while trimming', async () => {
    renderOverlay()
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 })
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    expect(screen.queryByLabelText('Rotate video')).toBeNull()
  })
})

describe('QuickLookOverlay rotate flow', () => {
  // Open the rotate dialog; entry is gated on the same ffmpeg capability
  // probe the trim feature uses.
  async function openRotate(overrides) {
    if (overrides) window.winraid = createWinraidMock(overrides)
    renderOverlay()
    fireEvent.click(screen.getByLabelText('Rotate video'))
    await act(async () => {})
  }

  it('checks the ffmpeg capability and opens the rotate dialog', async () => {
    await openRotate()
    expect(window.winraid.remote.trimCapability).toHaveBeenCalledWith('c1')
    expect(screen.getByTestId('rotate-modal')).toBeInTheDocument()
  })

  it('defaults to rotate right and saves a 90-degree clockwise copy', async () => {
    await openRotate()
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(window.winraid.remote.rotateVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/v/clip.mp4', outPath: '/v/clip_rotated.mp4', degrees: 90,
    })))
  })

  it('picks the next free _rotated name when one already exists', async () => {
    await openRotate({
      remote: { list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'clip_rotated.mp4', type: 'file' }] }) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(window.winraid.remote.rotateVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      outPath: '/v/clip_rotated_2.mp4',
    })))
  })

  it('sends 270 degrees for rotate left', async () => {
    await openRotate()
    fireEvent.click(screen.getByLabelText('Rotate left'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(window.winraid.remote.rotateVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      degrees: 270,
    })))
  })

  it('sends 180 degrees for the half-turn option', async () => {
    await openRotate()
    fireEvent.click(screen.getByLabelText('Rotate 180'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(window.winraid.remote.rotateVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      degrees: 180,
    })))
  })

  it('passes the original path as outPath for Overwrite', async () => {
    await openRotate()
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(window.winraid.remote.rotateVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/v/clip.mp4', outPath: '/v/clip.mp4', degrees: 90,
    })))
  })

  it('closes the dialog after a successful rotation', async () => {
    await openRotate()
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(screen.queryByTestId('rotate-modal')).toBeNull())
  })

  it('keeps the dialog open when the rotation fails', async () => {
    await openRotate({
      remote: { rotateVideo: vi.fn().mockResolvedValue({ ok: false, error: 'ffmpeg exited 1' }) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(window.winraid.remote.rotateVideo).toHaveBeenCalled())
    expect(screen.getByTestId('rotate-modal')).toBeInTheDocument()
  })

  it('cancel closes the dialog without rotating', async () => {
    await openRotate()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('rotate-modal')).toBeNull()
    expect(window.winraid.remote.rotateVideo).not.toHaveBeenCalled()
  })

  it('shows the ffmpeg setup dialog when no engine exists', async () => {
    await openRotate({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'none' }) },
    })
    expect(screen.queryByTestId('rotate-modal')).toBeNull()
    expect(screen.getByTestId('trim-setup-modal')).toBeInTheDocument()
  })

  it('continues into the rotate dialog after choosing the local engine', async () => {
    await openRotate({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'local' }) },
    })
    expect(screen.queryByTestId('rotate-modal')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Trim locally' }))
    expect(screen.getByTestId('rotate-modal')).toBeInTheDocument()
  })
})

describe('QuickLookOverlay video crop icon', () => {
  it('shows the Crop icon for an SFTP video', () => {
    renderOverlay()
    expect(screen.getByLabelText('Crop video')).toBeInTheDocument()
  })

  it('hides the Crop icon when the connection cannot server-edit (SMB)', () => {
    renderOverlay({ canServerEdit: false })
    expect(screen.queryByLabelText('Crop video')).toBeNull()
  })

  it('hides the Crop icon while trimming', async () => {
    renderOverlay()
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 })
    fireEvent.click(screen.getByLabelText('Trim video'))
    await act(async () => {})
    expect(screen.queryByLabelText('Crop video')).toBeNull()
  })
})

describe('QuickLookOverlay video crop flow', () => {
  // Enter video crop mode; entry is gated on the same ffmpeg capability probe
  // the trim and rotate features use.
  async function openVideoCrop(overrides, props) {
    if (overrides) window.winraid = createWinraidMock(overrides)
    renderOverlay(props)
    fireEvent.click(screen.getByLabelText('Crop video'))
    await act(async () => {})
  }

  // Give the (possibly remounted) crop-mode video element known dimensions:
  // source 1920x1080 rendered at 960x540, so display->source scale is 2x.
  function sizeVideo() {
    const video = document.querySelector('video')
    Object.defineProperty(video, 'videoWidth',   { configurable: true, value: 1920 })
    Object.defineProperty(video, 'videoHeight',  { configurable: true, value: 1080 })
    Object.defineProperty(video, 'clientWidth',  { configurable: true, value: 960 })
    Object.defineProperty(video, 'clientHeight', { configurable: true, value: 540 })
    return video
  }

  // The mocked ReactCrop fires onComplete({x:10, y:10, width:100, height:50})
  // on click — a finished drag selection in CSS pixels.
  async function selectRegion() {
    sizeVideo()
    fireEvent.click(screen.getByTestId('react-crop'))
    await act(async () => {})
  }

  it('checks the ffmpeg capability and enters crop mode around the video', async () => {
    await openVideoCrop()
    expect(window.winraid.remote.trimCapability).toHaveBeenCalledWith('c1')
    const wrapper = screen.getByTestId('react-crop')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper.querySelector('video')).not.toBeNull()
    expect(screen.getByText('Save copy')).toBeInTheDocument()
    expect(screen.getByText('Overwrite')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('shows the ffmpeg setup dialog when no engine exists', async () => {
    await openVideoCrop({
      remote: { trimCapability: vi.fn().mockResolvedValue({ ok: true, mode: 'none' }) },
    })
    expect(screen.queryByTestId('react-crop')).toBeNull()
    expect(screen.getByTestId('trim-setup-modal')).toBeInTheDocument()
  })

  it('disables Save until a selection is made', async () => {
    await openVideoCrop()
    expect(screen.getByRole('button', { name: 'Save copy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeDisabled()
    await selectRegion()
    expect(screen.getByRole('button', { name: 'Save copy' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Overwrite' })).not.toBeDisabled()
  })

  it('saves a copy with the selection scaled to source pixels', async () => {
    await openVideoCrop()
    await selectRegion()
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }))
    await waitFor(() => expect(window.winraid.remote.cropVideo).toHaveBeenCalledWith('c1', {
      path: '/v/clip.mp4',
      outPath: '/v/clip_cropped.mp4',
      rect: { x: 20, y: 20, width: 200, height: 100 },
    }))
  })

  it('picks the next free _cropped name when one already exists', async () => {
    await openVideoCrop({
      remote: { list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'clip_cropped.mp4', type: 'file' }] }) },
    })
    await selectRegion()
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }))
    await waitFor(() => expect(window.winraid.remote.cropVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      outPath: '/v/clip_cropped_2.mp4',
    })))
  })

  it('passes the original path as outPath for Overwrite', async () => {
    await openVideoCrop()
    await selectRegion()
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(window.winraid.remote.cropVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/v/clip.mp4', outPath: '/v/clip.mp4',
    })))
  })

  it('navigates to the new copy after a successful save', async () => {
    const onNavigate = vi.fn()
    await openVideoCrop(undefined, { onNavigate })
    await selectRegion()
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ path: '/v/clip_cropped.mp4' })))
  })

  it('stays in crop mode when the crop fails', async () => {
    await openVideoCrop({
      remote: { cropVideo: vi.fn().mockResolvedValue({ ok: false, error: 'ffmpeg exited 1' }) },
    })
    await selectRegion()
    fireEvent.click(screen.getByRole('button', { name: 'Save copy' }))
    await waitFor(() => expect(window.winraid.remote.cropVideo).toHaveBeenCalled())
    expect(screen.getByTestId('react-crop')).toBeInTheDocument()
  })

  it('cancel exits crop mode without cropping', async () => {
    await openVideoCrop()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByTestId('react-crop')).toBeNull()
    expect(window.winraid.remote.cropVideo).not.toHaveBeenCalled()
  })

  it('Escape exits crop mode rather than closing the overlay', async () => {
    const onClose = vi.fn()
    await openVideoCrop(undefined, { onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('react-crop')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Image rotate — a one-click top-bar operation: pressing the button rotates
// the image 90 degrees clockwise (the arrow direction) and overwrites it in
// place. No mode, no direction chooser, no save step. The in-crop rotate
// control (tested below, unchanged) keeps serving crop's own workflow.
// ---------------------------------------------------------------------------

const unknownFile = { name: 'archive.zip', path: '/media/archive.zip', size: 100, modified: 0 }

describe('QuickLookOverlay image rotate icon', () => {
  it('renders the Rotate button for image files, reachable without entering crop', async () => {
    render(<QuickLookOverlay {...baseProps} file={imageFile} />)
    await act(async () => {})
    expect(screen.getByLabelText('Rotate image')).toBeInTheDocument()
    expect(screen.queryByText('Aspect')).not.toBeInTheDocument()
  })

  it('does not render the Rotate button for audio files', async () => {
    render(<QuickLookOverlay {...baseProps} file={audioFile} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Rotate image')).not.toBeInTheDocument()
  })

  it('does not render the Rotate button for text files', async () => {
    render(<QuickLookOverlay {...baseProps} file={textFile} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Rotate image')).not.toBeInTheDocument()
  })

  it('does not render the Rotate button for unknown file types', async () => {
    render(<QuickLookOverlay {...baseProps} file={unknownFile} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Rotate image')).not.toBeInTheDocument()
  })
})

describe('QuickLookOverlay one-click image rotate', () => {
  let canvasMock, origCreateElement

  beforeEach(() => {
    const ctx = { drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn() }
    canvasMock = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((cb, mime) => cb(new Blob(['pixels'], { type: mime ?? 'image/jpeg' }))),
      _ctx: ctx,
    }
    origCreateElement = document.createElement.bind(document)
    document.createElement = (tag) => (tag === 'canvas' ? canvasMock : origCreateElement(tag))
  })

  afterEach(() => {
    document.createElement = origCreateElement
  })

  // Clicks the rotate button and gives the hidden pixel-source image known
  // native dimensions, so rotateImage has something real to compute from.
  // The rotate itself only runs once the source image fires its load event.
  async function clickRotate(props) {
    render(<QuickLookOverlay {...baseProps} file={imageFile} {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Rotate image'))
    await act(async () => {})
    const sourceImg = document.querySelector('.rotateSourceImage')
    expect(sourceImg).not.toBeNull()
    Object.defineProperty(sourceImg, 'naturalWidth',  { configurable: true, value: 800 })
    Object.defineProperty(sourceImg, 'naturalHeight', { configurable: true, value: 600 })
    return sourceImg
  }

  it('opens no chooser: no direction buttons, no save buttons, no cancel', async () => {
    await clickRotate()
    expect(screen.queryByLabelText('Rotate right')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rotate left')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rotate 180')).not.toBeInTheDocument()
    expect(screen.queryByText('Save copy')).not.toBeInTheDocument()
    expect(screen.queryByText('Overwrite')).not.toBeInTheDocument()
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('rotates 90 degrees clockwise and overwrites the file in place', async () => {
    const writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    const sourceImg = await clickRotate()
    fireEvent.load(sourceImg)
    await waitFor(() => expect(writeFileBinary).toHaveBeenCalledWith(
      'c1', '/media/photo.jpg', expect.anything(), { atomic: true },
    ))
    // 90-degree rotation swaps the canvas dimensions of the 800x600 source
    expect(canvasMock.width).toBe(600)
    expect(canvasMock.height).toBe(800)
    expect(canvasMock._ctx.rotate).toHaveBeenCalledWith((90 * Math.PI) / 180)
  })

  it('invalidates the file cache and re-renders the preview cache-busted', async () => {
    const writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    const sourceImg = await clickRotate()
    fireEvent.load(sourceImg)
    await waitFor(() => expect(window.winraid.cache.invalidateFile).toHaveBeenCalledWith('c1', '/media/photo.jpg'))
    await waitFor(() => {
      const img = document.querySelector('.previewImage')
      expect(img.src).toContain('bust=')
    })
  })

  it('disables the button while a rotate is in flight and re-enables after', async () => {
    let resolveWrite
    const writeFileBinary = vi.fn(() => new Promise((resolve) => { resolveWrite = resolve }))
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    const sourceImg = await clickRotate()
    expect(screen.getByLabelText('Rotate image')).toBeDisabled()
    fireEvent.load(sourceImg)
    await waitFor(() => expect(writeFileBinary).toHaveBeenCalled())
    expect(screen.getByLabelText('Rotate image')).toBeDisabled()
    await act(async () => { resolveWrite({ ok: true }) })
    await waitFor(() => expect(screen.getByLabelText('Rotate image')).not.toBeDisabled())
  })

  it('rotates again from the refreshed file on a second click', async () => {
    const writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    const first = await clickRotate()
    fireEvent.load(first)
    await waitFor(() => expect(writeFileBinary).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByLabelText('Rotate image')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('Rotate image'))
    await act(async () => {})
    const second = document.querySelector('.rotateSourceImage')
    // The second rotate must read the just-saved file, not a stale cache
    expect(second.src).toContain('bust=')
    Object.defineProperty(second, 'naturalWidth',  { configurable: true, value: 600 })
    Object.defineProperty(second, 'naturalHeight', { configurable: true, value: 800 })
    fireEvent.load(second)
    await waitFor(() => expect(writeFileBinary).toHaveBeenCalledTimes(2))
  })

  it('keeps Prev/Next navigation enabled — a rotate is not a mode', async () => {
    const files = [
      { name: 'a.jpg', path: '/media/a.jpg', size: 100, modified: 0 },
      { name: 'b.jpg', path: '/media/b.jpg', size: 100, modified: 0 },
    ]
    const writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    render(<QuickLookOverlay {...baseProps} files={files} file={files[0]} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Rotate image'))
    expect(screen.getByLabelText('Next file')).not.toBeDisabled()
  })

  it('writes to the file that was open when rotate was clicked, even after navigating', async () => {
    const files = [
      { name: 'a.jpg', path: '/media/a.jpg', size: 100, modified: 0 },
      { name: 'b.jpg', path: '/media/b.jpg', size: 100, modified: 0 },
    ]
    const writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    const { rerender } = render(<QuickLookOverlay {...baseProps} files={files} file={files[0]} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Rotate image'))
    await act(async () => {})
    const sourceImg = document.querySelector('.rotateSourceImage')
    Object.defineProperty(sourceImg, 'naturalWidth',  { configurable: true, value: 800 })
    Object.defineProperty(sourceImg, 'naturalHeight', { configurable: true, value: 600 })
    rerender(<QuickLookOverlay {...baseProps} files={files} file={files[1]} />)
    fireEvent.load(sourceImg)
    await waitFor(() => expect(writeFileBinary).toHaveBeenCalledWith(
      'c1', '/media/a.jpg', expect.anything(), { atomic: true },
    ))
  })

  it('surfaces a write failure as a visible error and re-enables the button', async () => {
    const writeFileBinary = vi.fn().mockResolvedValue({ ok: false, error: 'Disk full' })
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    const sourceImg = await clickRotate()
    fireEvent.load(sourceImg)
    await waitFor(() => expect(screen.getByText('Disk full')).toBeInTheDocument())
    expect(screen.getByLabelText('Rotate image')).not.toBeDisabled()
  })

  it('surfaces a source-load failure as a visible error and re-enables the button', async () => {
    const sourceImg = await clickRotate()
    fireEvent.error(sourceImg)
    await waitFor(() => expect(screen.getByText('Could not load image')).toBeInTheDocument())
    expect(screen.getByLabelText('Rotate image')).not.toBeDisabled()
  })

  it('hides the Rotate button while cropping', async () => {
    render(<QuickLookOverlay {...baseProps} file={imageFile} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Crop image'))
    expect(screen.queryByLabelText('Rotate image')).not.toBeInTheDocument()
  })

  it('Escape still closes the overlay after a rotate click — there is no mode to exit', async () => {
    const onClose = vi.fn()
    const writeFileBinary = vi.fn().mockResolvedValue({ ok: true })
    window.winraid = createWinraidMock({ remote: { writeFileBinary } })
    render(<QuickLookOverlay {...baseProps} file={imageFile} onClose={onClose} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Rotate image'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('QuickLookOverlay crop-mode rotate control (unchanged by one-click image rotate)', () => {
  let canvasMock, origCreateElement

  beforeEach(() => {
    const ctx = { drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn() }
    canvasMock = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toBlob: vi.fn((cb, mime) => cb(new Blob(['x'], { type: mime ?? 'image/jpeg' }))),
    }
    origCreateElement = document.createElement.bind(document)
    document.createElement = (tag) => (tag === 'canvas' ? canvasMock : origCreateElement(tag))
    Object.defineProperty(globalThis, 'URL', {
      configurable: true,
      value: { ...globalThis.URL, createObjectURL: vi.fn(() => 'blob:crop-rotated'), revokeObjectURL: vi.fn() },
    })
  })

  afterEach(() => {
    document.createElement = origCreateElement
  })

  it('still rotates the crop source image via the in-crop rotate control', async () => {
    render(<QuickLookOverlay {...baseProps} file={imageFile} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('Crop image'))
    const cropImg = screen.getByTestId('react-crop').querySelector('img')
    Object.defineProperty(cropImg, 'naturalWidth',  { configurable: true, value: 800 })
    Object.defineProperty(cropImg, 'naturalHeight', { configurable: true, value: 600 })
    fireEvent.click(screen.getByLabelText('Rotate 90 degrees'))
    await act(async () => {})
    expect(cropImg.src).toContain('blob:crop-rotated')
  })
})
