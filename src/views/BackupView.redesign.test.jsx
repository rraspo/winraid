import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import BackupView from './BackupView'

// Contract under test — the Backup screen on the redesign, after
// ref/backup.png: a page header, the backup as a card with a status pill,
// the "remote → local" line, the run progress, and the actions; a footer
// note explaining the read-only contract. Configuring sources and the
// local destination, saving, running and cancelling keep working.
//
// DOM contract:
//   - <h1>Incremental backup</h1>
//   - subtitle "Pull NAS folders back to this PC — only what changed gets
//     copied"
//   - the status pill text: "Idle" before any run, "Running" while running,
//     "Done", "Cancelled" or "Error" afterwards
//   - each configured source renders a line "<remote path> → <local
//     destination>"
//   - the actions keep their names: "Run backup" when idle, "Cancel" while
//     running, "Save"
//   - a footer note containing "Nothing on the NAS is ever touched"

const BACKUP_CONFIG = { sources: ['/mnt/user/photos', '/mnt/user/docs'], localDest: 'D:\\Backups' }

function setup(runStatus = 'idle') {
  // The view reads the whole config object (no key) and picks its own slice.
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockResolvedValue({
        backupByConnection: { 'conn-1': BACKUP_CONFIG },
        connections: [{ id: 'conn-1', name: 'Atlas', type: 'sftp', sftp: { host: 'nas.local', remotePath: '/mnt/user' } }],
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
  const backupRun = { runStatus, stats: null, currentFile: null, lastRun: null }
  return { backupRun, setBackupRun: vi.fn() }
}

async function mount(runStatus) {
  const props = setup(runStatus)
  render(<BackupView connectionId="conn-1" {...props} />)
  await act(async () => {})
}

afterEach(() => { delete window.winraid })
beforeEach(() => {})

describe('BackupView redesign', () => {
  it('has the title, the subtitle and the footer note', async () => {
    await mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Incremental backup' })).toBeInTheDocument()
    expect(screen.getByText('Pull NAS folders back to this PC — only what changed gets copied')).toBeInTheDocument()
    expect(screen.getByText(/Nothing on the NAS is ever touched/)).toBeInTheDocument()
  })

  it('shows Idle before a run with the Run backup and Save actions', async () => {
    await mount('idle')
    expect(screen.getByText('Idle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run backup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('shows Running with a Cancel action during a run', async () => {
    await mount('running')
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run backup' })).toBeNull()
  })

  it('lists each source as remote → local', async () => {
    await mount()
    expect(await screen.findByText('/mnt/user/photos → D:\\Backups')).toBeInTheDocument()
    expect(screen.getByText('/mnt/user/docs → D:\\Backups')).toBeInTheDocument()
  })
})
