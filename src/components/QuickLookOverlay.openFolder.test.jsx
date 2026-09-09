import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import QuickLookOverlay from './QuickLookOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

// Contract under test — a file opened from the play wall can be traced back
// to where it lives. Walking a recursive wall, the file on screen may sit
// several folders away from anything the browser is showing, and until now
// there was no way from the open file to its folder.
//
// DOM contract:
//   - when Quick Look is given an `onOpenFolder` callback, its More actions
//     menu carries "Open folder", which calls
//     onOpenFolder(<the file's parent folder>) and closes the menu
//   - without the callback the item is absent, so the browser's own Quick
//     Look, where you are already in that folder, is unchanged

const FILES = [
  { name: 'a.jpg',   path: '/photos/2026/a.jpg',      size: 100,  modified: 0 },
  { name: 'clip.mp4', path: '/photos/2026/clip.mp4', size: 5000, modified: 0 },
]

beforeEach(() => { window.winraid = createWinraidMock() })
afterEach(() => { delete window.winraid })

async function mount(props = {}) {
  const onOpenFolder = vi.fn()
  render(
    <QuickLookOverlay
      file={FILES[0]}
      files={FILES}
      connectionId="c1"
      remoteBasePath="/photos"
      canServerEdit
      onNavigate={vi.fn()}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onOpenFolder={onOpenFolder}
      {...props}
    />,
  )
  await act(async () => {})
  return { onOpenFolder }
}

function dialog() {
  return screen.getByRole('dialog', { name: /^Quick Look: / })
}

function openMenu() {
  fireEvent.click(within(dialog()).getByLabelText('More actions'))
}

describe('QuickLookOverlay open folder', () => {
  it('takes you to the folder the open file lives in', async () => {
    const { onOpenFolder } = await mount()
    openMenu()
    fireEvent.click(within(dialog()).getByText('Open folder'))
    expect(onOpenFolder).toHaveBeenCalledWith('/photos/2026')
  })

  it('closes the menu once it has acted', async () => {
    await mount()
    openMenu()
    fireEvent.click(within(dialog()).getByText('Open folder'))
    expect(within(dialog()).queryByText('Open folder')).toBeNull()
  })

  it('uses the folder of whichever file is open', async () => {
    const { onOpenFolder } = await mount({
      file: { name: 'deep.jpg', path: '/photos/2026/trip/deep.jpg', size: 10, modified: 0 },
    })
    openMenu()
    fireEvent.click(within(dialog()).getByText('Open folder'))
    expect(onOpenFolder).toHaveBeenCalledWith('/photos/2026/trip')
  })

  it('is absent when no folder callback is given', async () => {
    await mount({ onOpenFolder: undefined })
    openMenu()
    expect(within(dialog()).queryByText('Open folder')).toBeNull()
    // The rest of the menu is untouched.
    expect(within(dialog()).getByText('Delete')).toBeTruthy()
  })
})
