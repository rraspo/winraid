import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import QueueView from './QueueView'

// Contract under test — the Queue on the redesign, after ref/queue.png:
// the table becomes four groups, with a connection filter above them.
//
// DOM contract:
//   - <h1>Queue</h1> with a subtitle summarizing the load
//   - a connection filter: buttons "All" plus one per connection name,
//     with aria-pressed on the active one; a pressed connection hides
//     every job from other connections
//   - group sections, each <section aria-label="<group>">, in this order:
//     "Transferring" (TRANSFERRING jobs; "Nothing transferring" when none),
//     "Waiting" (PENDING, heading text "Waiting · <n>"),
//     "Failed" (ERROR, heading "Failed · <n>", each row with Retry and
//     Remove), "Completed today" (DONE, heading "Completed today · <n>",
//     with "Clear done" and "Clear stale" actions)
//   - transferring rows keep a Cancel button and the percentage; failed
//     rows show the error message; waiting rows keep Cancel
//   - job rows keep the connection name and the size

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', sftp: { host: '10.0.0.1', remotePath: '/mnt' } },
  { id: 'conn-2', name: 'Vault', sftp: { host: '10.0.0.1', remotePath: '/docs' } },
]

function job(overrides) {
  return {
    id: 'job', srcPath: '/local/files/file.bin', filename: 'file.bin', relPath: 'file.bin',
    size: 1048576, status: 'PENDING', progress: 0, errorMsg: '', connectionId: 'conn-1',
    createdAt: Date.now(), ...overrides,
  }
}

const JOBS = [
  job({ id: 'j1', filename: 'moving.mp4',  status: 'TRANSFERRING', progress: 0.42 }),
  job({ id: 'j2', filename: 'next.jpg',    status: 'PENDING' }),
  job({ id: 'j3', filename: 'later.jpg',   status: 'PENDING', connectionId: 'conn-2' }),
  job({ id: 'j4', filename: 'broken.xlsx', status: 'ERROR', errorMsg: 'Name collision on NAS', connectionId: 'conn-2' }),
  job({ id: 'j5', filename: 'done.txt',    status: 'DONE', progress: 1 }),
]

beforeEach(() => {
  window.winraid = createWinraidMock({ queue: { list: vi.fn().mockResolvedValue(JOBS) } })
})

afterEach(() => { delete window.winraid })

async function mount() {
  render(<QueueView connections={CONNECTIONS} />)
  await screen.findByText('moving.mp4')
}

function group(name) {
  return screen.getByRole('region', { name })
}

describe('QueueView redesign', () => {
  it('has the title and the four groups in prototype order', async () => {
    await mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Queue' })).toBeInTheDocument()
    const groups = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(groups).toEqual(['Transferring', 'Waiting', 'Failed', 'Completed today'])
  })

  it('counts the waiting, failed and completed groups in their headings', async () => {
    await mount()
    expect(within(group('Waiting')).getByText('Waiting · 2')).toBeInTheDocument()
    expect(within(group('Failed')).getByText('Failed · 1')).toBeInTheDocument()
    expect(within(group('Completed today')).getByText('Completed today · 1')).toBeInTheDocument()
  })

  it('places each job in its group with its connection and size', async () => {
    await mount()
    expect(within(group('Transferring')).getByText('moving.mp4')).toBeInTheDocument()
    expect(within(group('Transferring')).getByText(/42%/)).toBeInTheDocument()
    expect(within(group('Waiting')).getByText('next.jpg')).toBeInTheDocument()
    expect(within(group('Waiting')).getByText('later.jpg')).toBeInTheDocument()
    expect(within(group('Failed')).getByText('broken.xlsx')).toBeInTheDocument()
    expect(within(group('Failed')).getByText('Name collision on NAS')).toBeInTheDocument()
    expect(within(group('Completed today')).getByText('done.txt')).toBeInTheDocument()
    expect(within(group('Waiting')).getAllByText('Atlas').length).toBeGreaterThan(0)
    expect(within(group('Waiting')).getAllByText('1.0 MB').length).toBeGreaterThan(0)
  })

  it('keeps the row actions: Cancel, Retry, Remove, Clear done, Clear stale', async () => {
    await mount()
    fireEvent.click(within(group('Transferring')).getByRole('button', { name: 'Cancel' }))
    expect(window.winraid.queue.cancel).toHaveBeenCalledWith('j1')
    fireEvent.click(within(group('Failed')).getByRole('button', { name: 'Retry' }))
    expect(window.winraid.queue.retry).toHaveBeenCalledWith('j4')
    fireEvent.click(within(group('Failed')).getByRole('button', { name: 'Remove' }))
    expect(window.winraid.queue.remove).toHaveBeenCalledWith('j4')
    fireEvent.click(within(group('Completed today')).getByRole('button', { name: 'Clear done' }))
    expect(window.winraid.queue.clearDone).toHaveBeenCalledTimes(1)
    fireEvent.click(within(group('Completed today')).getByRole('button', { name: 'Clear stale' }))
    expect(window.winraid.queue.clearStale).toHaveBeenCalledTimes(1)
  })

  it('says when nothing is transferring', async () => {
    window.winraid.queue.list.mockResolvedValue(JOBS.filter((entry) => entry.status !== 'TRANSFERRING'))
    render(<QueueView connections={CONNECTIONS} />)
    await screen.findByText('next.jpg')
    expect(within(group('Transferring')).getByText('Nothing transferring')).toBeInTheDocument()
  })

  it('filters by connection through the chips', async () => {
    await mount()
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }))
    expect(screen.getByRole('button', { name: 'Vault' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('next.jpg')).toBeNull()
    expect(screen.getByText('later.jpg')).toBeInTheDocument()
    expect(screen.getByText('broken.xlsx')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('next.jpg')).toBeInTheDocument()
  })
})
