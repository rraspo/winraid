import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import QuickLookOverlay from './QuickLookOverlay'

// Contract under test — Escape must still close Quick Look after the native
// media controls were used. Chromium's controls swallow every key while the
// <video>/<audio> element holds focus: after a click or drag on the seek bar
// neither keydown nor keyup for Escape reaches the page (verified in Chrome
// with real mouse input). So the media element must hand focus back as soon
// as it takes it; the controls keep working, since their clicks and drags
// never depended on keyboard focus.

const baseProps = {
  connectionId: 'c1',
  remotePath: '/media',
  onNavigate: vi.fn(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
}

beforeEach(() => { window.winraid = createWinraidMock() })
afterEach(() => { cleanup(); delete window.winraid; vi.useRealTimers() })

async function mountWith(file) {
  render(<QuickLookOverlay {...baseProps} file={file} files={[file]} />)
  await act(async () => {})
}

describe('Quick Look media elements give focus back after their controls are used', () => {
  it('a video that takes focus from its controls releases it', async () => {
    vi.useFakeTimers()
    await mountWith({ name: 'clip.mp4', path: '/media/clip.mp4', size: 1, modified: 0 })
    const video = document.querySelector('video')
    const blur = vi.spyOn(video, 'blur')

    fireEvent.focus(video)
    act(() => { vi.runOnlyPendingTimers() })

    expect(blur).toHaveBeenCalled()
  })

  it('an audio player that takes focus from its controls releases it', async () => {
    vi.useFakeTimers()
    await mountWith({ name: 'song.mp3', path: '/media/song.mp3', size: 1, modified: 0 })
    const audio = document.querySelector('audio')
    const blur = vi.spyOn(audio, 'blur')

    fireEvent.focus(audio)
    act(() => { vi.runOnlyPendingTimers() })

    expect(blur).toHaveBeenCalled()
  })

  it('Escape closes Quick Look once the video has given focus back', async () => {
    const onClose = vi.fn()
    render(<QuickLookOverlay {...baseProps} onClose={onClose} file={{ name: 'clip.mp4', path: '/media/clip.mp4', size: 1, modified: 0 }} files={[]} />)
    await act(async () => {})

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
