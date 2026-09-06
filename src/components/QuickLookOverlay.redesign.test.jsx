import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import QuickLookOverlay from './QuickLookOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

// Contract under test — Quick Look on the redesign, after ref/quick-look.png
// and ref/quick-look-video.png: a 54px top bar with the file name, the
// position counter and the path on the left and the labeled tools on the
// right; large side arrows; a bottom hint. Every tool, key and edit flow
// in QuickLookOverlay.test.jsx keeps its accessible name and behavior.
//
// DOM contract:
//   - the dialog keeps its name "Quick Look: <file name>"
//   - the top bar shows a counter "<index> / <total>" for the file within
//     `files`
//   - image tools read "Rotate" and "Crop" as visible text on the buttons
//     whose accessible names stay "Rotate image" and "Crop image"; video
//     tools read "Trim", "Rotate", "Crop", "Snapshot" on the buttons whose
//     names stay "Trim video", "Rotate video", "Crop video", "Save video
//     snapshot"
//   - "Previous file" and "Next file" stay as the side arrows
//   - a hint line reads "← → to step through the folder"

const FILES = [
  { name: 'a.jpg', path: '/photos/a.jpg', size: 100, modified: 0 },
  { name: 'b.jpg', path: '/photos/b.jpg', size: 100, modified: 0 },
  { name: 'clip.mp4', path: '/photos/clip.mp4', size: 5000, modified: 0 },
]

beforeEach(() => {
  window.winraid = createWinraidMock()
})

afterEach(() => { delete window.winraid })

async function mount(file) {
  render(
    <QuickLookOverlay
      file={file}
      files={FILES}
      connectionId="c1"
      remoteBasePath="/photos"
      canServerEdit
      onNavigate={vi.fn()}
      onClose={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  await act(async () => {})
}

function dialog(name) {
  return screen.getByRole('dialog', { name: `Quick Look: ${name}` })
}

describe('QuickLookOverlay redesign', () => {
  it('shows the position counter for the open file', async () => {
    await mount(FILES[1])
    expect(within(dialog('b.jpg')).getByText('2 / 3')).toBeTruthy()
  })

  it('labels the image tools visibly while keeping their accessible names', async () => {
    await mount(FILES[0])
    const rotate = within(dialog('a.jpg')).getByRole('button', { name: 'Rotate image' })
    const crop   = within(dialog('a.jpg')).getByRole('button', { name: 'Crop image' })
    expect(rotate.textContent).toContain('Rotate')
    expect(crop.textContent).toContain('Crop')
  })

  it('labels the video tools visibly while keeping their accessible names', async () => {
    await mount(FILES[2])
    const scope = within(dialog('clip.mp4'))
    expect(scope.getByRole('button', { name: 'Trim video' }).textContent).toContain('Trim')
    expect(scope.getByRole('button', { name: 'Rotate video' }).textContent).toContain('Rotate')
    expect(scope.getByRole('button', { name: 'Crop video' }).textContent).toContain('Crop')
    expect(scope.getByRole('button', { name: 'Save video snapshot' }).textContent).toContain('Snapshot')
  })

  it('keeps the side arrows and shows the keyboard hint', async () => {
    await mount(FILES[1])
    const scope = within(dialog('b.jpg'))
    expect(scope.getByRole('button', { name: 'Previous file' })).toBeTruthy()
    expect(scope.getByRole('button', { name: 'Next file' })).toBeTruthy()
    expect(scope.getByText('← → to step through the folder')).toBeTruthy()
  })
})
