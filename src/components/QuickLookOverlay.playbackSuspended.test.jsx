import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import QuickLookOverlay from './QuickLookOverlay'

// Contract under test — a Browse tab stays mounted (only hidden) while the
// user is on another tab or view, so a Quick Look open inside it would keep
// playing its video or audio out of sight. While playback is suspended the
// viewer's media is paused; it is not resumed on its own when the tab
// returns, so nothing starts playing behind the user's back.

const baseProps = {
  connectionId: 'c1',
  remotePath: '/media',
  onNavigate: vi.fn(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
}

const video = { name: 'clip.mp4', path: '/media/clip.mp4', size: 1, modified: 0 }
const audio = { name: 'song.mp3', path: '/media/song.mp3', size: 1, modified: 0 }

beforeEach(() => { window.winraid = createWinraidMock() })
afterEach(() => { cleanup(); delete window.winraid; vi.restoreAllMocks() })

async function mountWith(file, playbackSuspended = false) {
  const view = render(<QuickLookOverlay {...baseProps} file={file} files={[file]} playbackSuspended={playbackSuspended} />)
  await act(async () => {})
  return view
}

describe('Quick Look pauses its media while playback is suspended', () => {
  it('pauses a playing video once its tab is hidden', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { rerender } = await mountWith(video)
    expect(pause).not.toHaveBeenCalled()

    rerender(<QuickLookOverlay {...baseProps} file={video} files={[video]} playbackSuspended />)

    expect(pause).toHaveBeenCalled()
    expect(pause.mock.contexts.at(-1)).toBe(document.querySelector('video'))
  })

  it('pauses a playing audio file once its tab is hidden', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const { rerender } = await mountWith(audio)

    rerender(<QuickLookOverlay {...baseProps} file={audio} files={[audio]} playbackSuspended />)

    expect(pause.mock.contexts.at(-1)).toBe(document.querySelector('audio'))
  })

  it('does not resume playback when the tab comes back', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const { rerender } = await mountWith(video, true)
    play.mockClear()

    rerender(<QuickLookOverlay {...baseProps} file={video} files={[video]} playbackSuspended={false} />)

    expect(play).not.toHaveBeenCalled()
  })
})
