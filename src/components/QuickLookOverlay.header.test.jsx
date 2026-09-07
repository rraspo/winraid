import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import QuickLookOverlay from './QuickLookOverlay'
import { createWinraidMock } from '../__mocks__/winraid'

vi.mock('react-image-crop', () => ({
  default: ({ children }) => <div data-testid="react-crop">{children}</div>,
}))
vi.mock('react-image-crop/dist/ReactCrop.css', () => ({}))

// Contract under test — the viewer's header gives the file room to breathe
// and makes its path usable. Everything used to sit on one line, so the
// name, the position and the path fought for the same width and the path
// was plain text you could not act on.
//
// DOM contract:
//   - the header is two rows: the file's name alone on top, and beneath it
//     a details row carrying the position counter and the folder path
//   - the folder path renders as one button per segment; choosing one calls
//     onOpenFolder with that folder's full path
//   - without an onOpenFolder callback the segments are plain text, so the
//     header still reads the same where there is nowhere to go
//   - the name is never truncated by the details beside it, because they
//     are no longer beside it

const FILES = [
  { name: 'a-rather-long-holiday-photo-name.jpg', path: '/photos/2026/trip/a-rather-long-holiday-photo-name.jpg', size: 100, modified: 0 },
  { name: 'b.jpg', path: '/photos/2026/trip/b.jpg', size: 100, modified: 0 },
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

function nameRow() {
  return screen.getByTestId('quick-look-name-row')
}

function detailsRow() {
  return screen.getByTestId('quick-look-details-row')
}

describe('QuickLookOverlay header', () => {
  it('puts the file name on its own row', async () => {
    await mount()
    expect(within(nameRow()).getByText('a-rather-long-holiday-photo-name.jpg')).toBeTruthy()
    expect(within(nameRow()).queryByText('1 / 2')).toBeNull()
  })

  it('puts the position and the path on the row beneath it', async () => {
    await mount()
    expect(within(detailsRow()).getByText('1 / 2')).toBeTruthy()
    expect(within(detailsRow()).getByRole('button', { name: 'trip' })).toBeTruthy()
  })

  it('walks to a folder from its path segment', async () => {
    const { onOpenFolder } = await mount()
    fireEvent.click(within(detailsRow()).getByRole('button', { name: '2026' }))
    expect(onOpenFolder).toHaveBeenCalledWith('/photos/2026')
  })

  it('walks to the folder the file itself is in', async () => {
    const { onOpenFolder } = await mount()
    fireEvent.click(within(detailsRow()).getByRole('button', { name: 'trip' }))
    expect(onOpenFolder).toHaveBeenCalledWith('/photos/2026/trip')
  })

  it('leaves the path as plain text when there is nowhere to go', async () => {
    await mount({ onOpenFolder: undefined })
    expect(within(detailsRow()).queryByRole('button', { name: 'trip' })).toBeNull()
    expect(detailsRow().textContent).toContain('trip')
  })

  it('keeps the name reachable for copying', async () => {
    await mount()
    fireEvent.click(within(nameRow()).getByRole('button', { name: /a-rather-long-holiday-photo-name\.jpg/ }))
    expect(within(nameRow()).getByText('Copied')).toBeTruthy()
  })
})
