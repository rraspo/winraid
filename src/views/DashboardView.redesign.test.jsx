import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import DashboardView from './DashboardView'

// Contract under test — the Dashboard on the redesign, after
// ref/dashboard.png in the design bundle. Everything shown comes from data
// the app already has: the queue store, watcher status, the activity feed
// and per-connection disk usage.
//
// DOM contract:
//   - <h1>Dashboard</h1> with the subtitle "Lifetime activity across <n>
//     connections" ("1 connection" in the singular)
//   - a "Pause all" / "Resume all" button driven by queuePaused, calling
//     onGlobalToggle
//   - four stat tiles, each <article aria-label="<label>"> in this order:
//     "Files synced" (queue.stats().lifetimeCompleted), "In queue"
//     (PENDING + TRANSFERRING jobs), "Watchers" ("<watching> of <total>"),
//     "Failed" (ERROR jobs) whose tile holds a "view in queue" control
//     calling onNavigate('queue')
//   - a "Recent activity" section listing activityEntries by title,
//     "No activity yet" when empty
//   - one <article aria-label="<connection name>"> per connection with the
//     protocol badge (SFTP / SMB), the local folder, the remote path, the
//     watcher word (Watching / Paused / Stopped), and the disk line
//     "<used> of <total>" (or "Disk usage unavailable")

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', icon: null, localFolder: 'C:\\Users\\user\\Pictures', sftp: { host: '10.0.0.1', remotePath: '/mnt/data' } },
  { id: 'conn-2', name: 'Vault', type: 'smb',  icon: null, localFolder: 'C:\\Users\\user\\Documents', smb: { share: '\\\\10.0.0.1\\docs', remotePath: '/docs' } },
]

const JOBS = [
  { id: 'j1', filename: 'a.mp4', status: 'PENDING',      progress: 0,   srcPath: '/local/a.mp4', connectionId: 'conn-1', size: 10 },
  { id: 'j2', filename: 'b.jpg', status: 'TRANSFERRING', progress: 0.4, srcPath: '/local/b.jpg', connectionId: 'conn-1', size: 10 },
  { id: 'j3', filename: 'c.pdf', status: 'ERROR',        progress: 0,   srcPath: '/local/c.pdf', connectionId: 'conn-2', size: 10, errorMsg: 'Denied' },
  { id: 'j4', filename: 'd.txt', status: 'DONE',         progress: 1,   srcPath: '/local/d.txt', connectionId: 'conn-2', size: 10 },
]

const ACTIVITY = [
  { id: 'a1', ts: Date.now() - 60_000, level: 'info', type: 'transfer', title: 'clip.mp4 uploaded', detail: 'Atlas', connectionId: 'conn-1' },
  { id: 'a2', ts: Date.now() - 120_000, level: 'info', type: 'verify',  title: 'Verification passed', detail: 'Vault', connectionId: 'conn-2' },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    remote: {
      diskUsage: vi.fn().mockResolvedValue({ ok: true, total: 10 * 1024 ** 3, used: 4 * 1024 ** 3, free: 6 * 1024 ** 3 }),
    },
    queue: {
      list:  vi.fn().mockResolvedValue(JOBS),
      stats: vi.fn().mockResolvedValue({ lifetimeCompleted: 18942 }),
    },
  })
})

afterEach(() => { delete window.winraid; vi.restoreAllMocks() })

function mount(props = {}) {
  const onNavigate     = vi.fn()
  const onGlobalToggle = vi.fn()
  render(
    <DashboardView
      connections={CONNECTIONS}
      watcherStatus={{ 'conn-1': { watching: true, state: 'idle' }, 'conn-2': { watching: false, state: 'idle' } }}
      activityEntries={ACTIVITY}
      queuePaused={false}
      onGlobalToggle={onGlobalToggle}
      onNavigate={onNavigate}
      {...props}
    />,
  )
  return { onNavigate, onGlobalToggle }
}

function tile(label) {
  return screen.getByRole('article', { name: label })
}

describe('DashboardView redesign', () => {
  it('has the title and the connection-count subtitle', async () => {
    mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Lifetime activity across 2 connections')).toBeInTheDocument()
  })

  it('uses the singular for one connection', async () => {
    mount({ connections: [CONNECTIONS[0]] })
    expect(screen.getByText('Lifetime activity across 1 connection')).toBeInTheDocument()
  })

  it('offers Pause all, or Resume all while paused, wired to the global toggle', async () => {
    const { onGlobalToggle } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pause all' }))
    expect(onGlobalToggle).toHaveBeenCalledTimes(1)
    mount({ queuePaused: true })
    expect(screen.getByRole('button', { name: 'Resume all' })).toBeInTheDocument()
  })

  it('shows the four stat tiles in prototype order with real figures', async () => {
    mount()
    await waitFor(() => expect(within(tile('Files synced')).getByText('18,942')).toBeInTheDocument())
    expect(within(tile('In queue')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Watchers')).getByText('1 of 2')).toBeInTheDocument()
    expect(within(tile('Failed')).getByText('1')).toBeInTheDocument()
    const order = screen.getAllByRole('article')
      .map((article) => article.getAttribute('aria-label'))
      .filter((label) => ['Files synced', 'In queue', 'Watchers', 'Failed'].includes(label))
    expect(order).toEqual(['Files synced', 'In queue', 'Watchers', 'Failed'])
  })

  it('links the Failed tile to the queue', async () => {
    const { onNavigate } = mount()
    await waitFor(() => expect(within(tile('Failed')).getByText('1')).toBeInTheDocument())
    fireEvent.click(within(tile('Failed')).getByText('view in queue'))
    expect(onNavigate).toHaveBeenCalledWith('queue')
  })

  it('lists recent activity from the feed and says so when empty', async () => {
    mount()
    const section = screen.getByRole('region', { name: 'Recent activity' })
    expect(within(section).getByText('clip.mp4 uploaded')).toBeInTheDocument()
    expect(within(section).getByText('Verification passed')).toBeInTheDocument()
    mount({ activityEntries: [] })
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
  })

  it('renders a card per connection with protocol, paths, watcher word and disk usage', async () => {
    mount()
    const atlas = screen.getByRole('article', { name: 'Atlas' })
    expect(within(atlas).getByText('SFTP')).toBeInTheDocument()
    expect(atlas.textContent).toContain('C:\\Users\\user\\Pictures')
    expect(atlas.textContent).toContain('/mnt/data')
    expect(atlas.textContent).toContain('Watching')
    await waitFor(() => expect(atlas.textContent).toContain('4.00 GB of 10.00 GB'))
    const vault = screen.getByRole('article', { name: 'Vault' })
    expect(within(vault).getByText('SMB')).toBeInTheDocument()
    expect(vault.textContent).toContain('Stopped')
  })

  it('reports unavailable disk usage inside the card', async () => {
    window.winraid.remote.diskUsage = vi.fn().mockResolvedValue({ ok: false, error: 'Not supported' })
    mount()
    const atlas = screen.getByRole('article', { name: 'Atlas' })
    await waitFor(() => expect(atlas.textContent).toMatch(/unavailable/i))
  })
})
