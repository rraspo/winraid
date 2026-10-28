import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'
import QuickLookOverlay from './QuickLookOverlay'

// Contract under test — audio files trim the way videos do: the same Trim
// button, timeline, engine gate and save flow, with the timeline under the
// audio player and the copy speaking of audio rather than video.

const audioFile = { name: 'song.mp3', path: '/music/song.mp3', size: 100, modified: 0 }

const baseProps = {
  file: audioFile,
  connectionId: 'c1',
  remoteBasePath: '/music',
  files: [audioFile],
  onNavigate: vi.fn(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
}

beforeEach(() => { window.winraid = createWinraidMock() })
afterEach(() => { cleanup(); remoteFS.clearAll?.(); delete window.winraid; vi.restoreAllMocks() })

function setAudioDuration(duration) {
  const audio = document.querySelector('audio')
  Object.defineProperty(audio, 'duration', { configurable: true, value: duration })
  return audio
}

async function enterAudioTrim(duration = 30, props = {}) {
  render(<QuickLookOverlay {...baseProps} canServerEdit {...props} />)
  await act(async () => {})
  const audio = setAudioDuration(duration)
  fireEvent.click(screen.getByLabelText('Trim audio'))
  await act(async () => {})
  return audio
}

describe('QuickLookOverlay audio trim', () => {
  it('offers Trim for an audio file on an SFTP connection', async () => {
    render(<QuickLookOverlay {...baseProps} canServerEdit />)
    await act(async () => {})
    expect(screen.getByLabelText('Trim audio')).toBeInTheDocument()
  })

  it('does not offer Trim when the connection cannot server-edit (SMB)', async () => {
    render(<QuickLookOverlay {...baseProps} canServerEdit={false} />)
    await act(async () => {})
    expect(screen.queryByLabelText('Trim audio')).toBeNull()
  })

  it('opens the timeline under the audio player with the full duration selected', async () => {
    const audio = await enterAudioTrim(30)
    const bar = screen.getByTestId('trim-bar')
    expect(audio.parentElement.contains(bar)).toBe(true)
    expect(audio.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('trim-in').textContent).toContain('00:00')
    expect(screen.getByTestId('trim-out').textContent).toContain('00:30')
  })

  it('hides the native audio controls while trimming and restores them on cancel', async () => {
    const audio = await enterAudioTrim()
    expect(audio.controls).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(audio.controls).toBe(true)
  })

  it('says the audio duration is missing, not the video duration', async () => {
    const show = vi.spyOn(toast, 'show')
    render(<QuickLookOverlay {...baseProps} canServerEdit />)
    await act(async () => {})
    setAudioDuration(NaN)
    fireEvent.click(screen.getByLabelText('Trim audio'))
    await act(async () => {})
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringMatching(/^Audio duration/), type: 'error' }))
    expect(screen.queryByTestId('trim-bar')).toBeNull()
  })

  it('saves a _trimmed copy beside the original', async () => {
    const trimVideo = vi.fn().mockResolvedValue({ ok: true, outPath: '/music/song_trimmed.mp3', exact: true })
    window.winraid = createWinraidMock({
      remote: {
        list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'song.mp3', type: 'file' }] }),
        trimVideo,
      },
    })
    await enterAudioTrim(30)
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }))
    await waitFor(() => expect(trimVideo).toHaveBeenCalled())
    expect(trimVideo).toHaveBeenCalledWith('c1', expect.objectContaining({
      path: '/music/song.mp3', outPath: '/music/song_trimmed.mp3', start: 0, end: 30,
    }))
  })

  it('confirms an overwrite as "Audio trimmed"', async () => {
    const show = vi.spyOn(toast, 'show')
    const trimVideo = vi.fn().mockResolvedValue({ ok: true, outPath: '/music/song.mp3', exact: true })
    window.winraid = createWinraidMock({ remote: { trimVideo } })
    await enterAudioTrim(30)
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ msg: 'Audio trimmed', type: 'success' })))
  })

  it('surfaces a failed trim as an error', async () => {
    const show = vi.spyOn(toast, 'show')
    const trimVideo = vi.fn().mockResolvedValue({ ok: false, error: 'Invalid data found when processing input' })
    window.winraid = createWinraidMock({ remote: { trimVideo } })
    await enterAudioTrim(30)
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({
      msg: expect.stringContaining('Invalid data found when processing input'), type: 'error',
    })))
  })

  it('calls an mp3 trim lossless', async () => {
    await enterAudioTrim(30)
    expect(screen.getByText(/s kept/).textContent).toContain('Lossless trim')
  })

  it('does not promise a lossless trim for .ogg, which may hold Vorbis that has to be re-encoded', async () => {
    const oggFile = { name: 'song.ogg', path: '/music/song.ogg', size: 100, modified: 0 }
    await enterAudioTrim(30, { file: oggFile, files: [oggFile] })
    const summary = screen.getByText(/s kept/).textContent
    expect(summary).not.toContain('Lossless')
    expect(summary).toContain('30.0 s kept')
  })

  it('space toggles audio playback like it does for video', async () => {
    render(<QuickLookOverlay {...baseProps} canServerEdit />)
    await act(async () => {})
    const audio = document.querySelector('audio')
    Object.defineProperty(audio, 'paused', { configurable: true, value: true })
    audio.play = vi.fn().mockResolvedValue(undefined)
    fireEvent.keyDown(window, { key: ' ' })
    expect(audio.play).toHaveBeenCalled()
  })
})
