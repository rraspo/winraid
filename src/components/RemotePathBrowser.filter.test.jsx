import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import RemotePathBrowser from './RemotePathBrowser'

// Contract under test — the folder picker can be searched.
//
// Choosing where to move a file means finding one folder in a directory that
// may hold hundreds. The picker listed them and offered no way to narrow the
// list, so the only route to a folder was to read down it.
//
// A filter sits above the list. It matches on what you type, case- and
// accent-insensitively per the house rule, and it filters the folder you are
// looking at rather than searching the whole tree — moving into a folder
// clears it, because it described the list you just left.
//
// DOM contract:
//   - a text input placeheld "Filter folders"
//   - typing narrows the listed folders to those whose name contains the
//     text, ignoring case and accents
//   - a filter that matches nothing says so rather than showing a blank list
//   - navigating into a folder clears the filter

const DIRS = [
  { name: 'Archivos', type: 'dir' },
  { name: 'Música',   type: 'dir' },
  { name: 'Photos',   type: 'dir' },
  { name: 'photos-2026', type: 'dir' },
  { name: 'Videos',   type: 'dir' },
]

beforeEach(() => {
  window.winraid = {
    ssh: {
      listDir: vi.fn().mockResolvedValue({ ok: true, entries: DIRS }),
      mkdir:   vi.fn().mockResolvedValue({ ok: true }),
    },
  }
})

afterEach(() => { delete window.winraid })

async function mount() {
  render(
    <RemotePathBrowser
      sftpCfg={{ host: 'nas.local', port: 22, username: 'user' }}
      initialPath="/mnt/user"
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  await act(async () => {})
  await act(async () => {})
}

function filterBox() {
  return screen.getByPlaceholderText('Filter folders')
}

function listedFolders() {
  return DIRS.map((d) => d.name).filter((name) => screen.queryByText(name) !== null)
}

describe('filtering the folder picker', () => {
  it('offers a filter', async () => {
    await mount()
    expect(filterBox()).toBeTruthy()
  })

  it('narrows the list to matching folders', async () => {
    await mount()
    fireEvent.change(filterBox(), { target: { value: 'photo' } })
    expect(listedFolders()).toEqual(['Photos', 'photos-2026'])
  })

  it('ignores case', async () => {
    await mount()
    fireEvent.change(filterBox(), { target: { value: 'VIDEOS' } })
    expect(listedFolders()).toEqual(['Videos'])
  })

  it('ignores accents, so "musica" finds "Música"', async () => {
    await mount()
    fireEvent.change(filterBox(), { target: { value: 'musica' } })
    expect(listedFolders()).toEqual(['Música'])
  })

  it('says so when nothing matches', async () => {
    await mount()
    fireEvent.change(filterBox(), { target: { value: 'zzz' } })
    expect(listedFolders()).toEqual([])
    expect(screen.getByText(/No folders match/i)).toBeTruthy()
  })

  it('clears the filter on moving into a folder', async () => {
    await mount()
    fireEvent.change(filterBox(), { target: { value: 'photo' } })
    fireEvent.click(screen.getByText('Photos'))
    await act(async () => {})
    expect(filterBox().value).toBe('')
  })
})
