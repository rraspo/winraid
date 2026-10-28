import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import QueueView from './QueueView'

// Contract under test — the History group of the Activity screen: every
// recorded operation (uploads, moves, copies, renames, deletes, downloads),
// newest first, read from the persisted activity feed and kept live. A row
// with somewhere to go opens it: a remote destination in Browse with the
// item highlighted, a local folder in the OS file manager, a failure in Logs.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', sftp: { host: '10.0.0.1', remotePath: '/mnt' } },
  { id: 'conn-2', name: 'Vault', sftp: { host: '10.0.0.1', remotePath: '/docs' } },
]

const NOW = Date.now()

const MOVE = {
  id: 3, ts: NOW, type: 'move', level: 'info', connectionId: 'conn-1',
  title: 'Moved Trip', detail: '→ /mnt/archive', nav: { kind: 'remote', path: '/mnt/archive', highlight: 'Trip' },
}
const DOWNLOAD = {
  id: 2, ts: NOW - 1000, type: 'download', level: 'info', connectionId: 'conn-2',
  title: 'Downloaded report.pdf', detail: 'C:\\Downloads', nav: { kind: 'reveal', localPath: 'C:\\Downloads' },
}
const FAILED = {
  id: 1, ts: NOW - 2000, type: 'copy', level: 'error', connectionId: 'conn-1',
  title: 'Copy failed', detail: 'Permission denied', nav: null,
}

let entryCb

function mount(props = {}) {
  const onBrowsePath = vi.fn()
  const onNavigateLogs = vi.fn()
  render(<QueueView connections={CONNECTIONS} onBrowsePath={onBrowsePath} onNavigateLogs={onNavigateLogs} {...props} />)
  return { onBrowsePath, onNavigateLogs }
}

function history() {
  return screen.getByRole('region', { name: 'History' })
}

beforeEach(() => {
  window.winraid = createWinraidMock({
    activity: {
      tail:    vi.fn().mockResolvedValue([MOVE, DOWNLOAD, FAILED]),
      onEntry: vi.fn((cb) => { entryCb = cb; return () => {} }),
      clear:   vi.fn().mockResolvedValue({ ok: true }),
    },
  })
})

afterEach(() => { delete window.winraid })

describe('QueueView history', () => {
  it('lists every recorded operation newest first, even with nothing queued', async () => {
    mount()
    await screen.findByText('Moved Trip')
    const titles = within(history()).getAllByTestId('history-title').map((node) => node.textContent)
    expect(titles).toEqual(['Moved Trip', 'Downloaded report.pdf', 'Copy failed'])
    expect(within(history()).getByText('→ /mnt/archive')).toBeInTheDocument()
    expect(within(history()).getByText('Permission denied')).toBeInTheDocument()
  })

  it('opens a move at its destination folder with the moved item highlighted', async () => {
    const { onBrowsePath } = mount()
    fireEvent.click(await screen.findByText('Moved Trip'))
    expect(onBrowsePath).toHaveBeenCalledWith('conn-1', '/mnt/archive', 'Trip')
  })

  it('reveals a download in the file manager', async () => {
    mount()
    fireEvent.click(await screen.findByText('Downloaded report.pdf'))
    expect(window.winraid.activity.reveal).toHaveBeenCalledWith('C:\\Downloads')
  })

  it('opens a failure in Logs at the moment it happened', async () => {
    const { onNavigateLogs } = mount()
    fireEvent.click(await screen.findByText('Copy failed'))
    expect(onNavigateLogs).toHaveBeenCalledWith({ filename: '', errorAt: FAILED.ts })
  })

  it('adds new operations to the top as they happen', async () => {
    mount()
    await screen.findByText('Moved Trip')
    act(() => entryCb({ ...MOVE, id: 4, title: 'Moved Notes' }))
    expect(within(history()).getAllByTestId('history-title')[0].textContent).toBe('Moved Notes')
  })

  it('follows the connection filter', async () => {
    mount()
    await screen.findByText('Moved Trip')
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    expect(within(history()).queryByText('Moved Trip')).toBeNull()
    expect(within(history()).getByText('Downloaded report.pdf')).toBeInTheDocument()
  })

  it('clears the history only after a second, confirming click', async () => {
    mount()
    await screen.findByText('Moved Trip')
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
    expect(window.winraid.activity.clear).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear history?' })) })
    expect(window.winraid.activity.clear).toHaveBeenCalledTimes(1)
    expect(window.winraid.queue.clearDone).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Moved Trip')).toBeNull()
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
  })
})
