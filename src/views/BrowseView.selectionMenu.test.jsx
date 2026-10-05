import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — the overflow menu's Invert selection must complement
// the selected set against the CURRENT filtered+sorted list, not the raw
// directory listing. An active search filter narrows what is on screen;
// inverting must only flip what is actually visible, never reach into an
// entry a search query has hidden.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

// "o" narrows this fixture to Documents, Photos and video.mp4 — readme.txt
// has no "o" and stays hidden, the entry this test must never see selected.
const ENTRIES = [
  { name: 'Documents',   type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'Photos',      type: 'dir',  size: 0,        modified: Date.now() },
  { name: 'readme.txt',  type: 'file', size: 1024,     modified: Date.now() },
  { name: 'video.mp4',   type: 'file', size: 52428800, modified: Date.now() },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        if (key === 'activeConnectionId') return Promise.resolve('conn-1')
        return Promise.resolve({ connections: CONNECTIONS, activeConnectionId: 'conn-1' })
      }),
    },
    remote: { list: vi.fn().mockResolvedValue({ ok: true, entries: ENTRIES }) },
  })
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('list')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  remoteFS.clearAll()
  toast.clearAll()
  delete window.winraid
  vi.restoreAllMocks()
})

async function mount() {
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" />)
  await screen.findByText('readme.txt')
  return userEvent.setup()
}

function rowCheckboxInput(name) {
  return screen.getByText(name).closest('.row').querySelector('input[type="checkbox"]')
}

function rowCheckboxLabel(name) {
  return screen.getByText(name).closest('.row').querySelector('.checkbox')
}

async function openOverflowMenu(user) {
  await user.click(screen.getByRole('button', { name: 'More options' }))
}

describe('Invert selection respects an active search filter', () => {
  it('only flips entries the search query still shows, never a hidden one', async () => {
    const user = userEvent.setup()
    await mount()

    await user.type(screen.getByPlaceholderText('Search this folder'), 'o')
    // readme.txt has no "o" and drops out of the filtered list.
    expect(screen.queryByText('readme.txt')).toBeNull()
    await screen.findByText('Documents')
    await screen.findByText('Photos')
    await screen.findByText('video.mp4')

    await user.click(rowCheckboxLabel('Documents'))
    expect(rowCheckboxInput('Documents').checked).toBe(true)

    await openOverflowMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Invert selection' }))

    // Documents flips off; the other two entries the filter still shows
    // flip on.
    expect(rowCheckboxInput('Documents').checked).toBe(false)
    expect(rowCheckboxInput('Photos').checked).toBe(true)
    expect(rowCheckboxInput('video.mp4').checked).toBe(true)

    // Clear the filter and confirm the hidden entry was never touched.
    await user.clear(screen.getByPlaceholderText('Search this folder'))
    await screen.findByText('readme.txt')
    expect(rowCheckboxInput('readme.txt').checked).toBe(false)
  })

  it('selects every visible entry when none of them were selected', async () => {
    const user = userEvent.setup()
    await mount()

    await user.type(screen.getByPlaceholderText('Search this folder'), 'o')
    await screen.findByText('Documents')

    await openOverflowMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Invert selection' }))

    expect(rowCheckboxInput('Documents').checked).toBe(true)
    expect(rowCheckboxInput('Photos').checked).toBe(true)
    expect(rowCheckboxInput('video.mp4').checked).toBe(true)

    await user.clear(screen.getByPlaceholderText('Search this folder'))
    await screen.findByText('readme.txt')
    expect(rowCheckboxInput('readme.txt').checked).toBe(false)
  })
})

describe('Select none and Invert selection enable unconditionally', () => {
  it('are both enabled with nothing selected', async () => {
    const user = userEvent.setup()
    await mount()
    await openOverflowMenu(user)
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Select none' })).toBeEnabled()
    expect(within(menu).getByRole('menuitem', { name: 'Invert selection' })).toBeEnabled()
  })
})
