import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import SizeView from './SizeView'
import BackupView from './BackupView'

// Contract under test — the per-connection screens carry the connection
// picker in their own header, so the connection they are showing is always
// named and can be changed without leaving the screen. Before this, the
// nav rail resolved a connection silently and the screen gave no clue
// which one it had picked.
//
// DOM contract, for Size map and Backup alike:
//   - the screen's header holds the picker (a button named
//     "Connection: <name>")
//   - choosing another connection calls onSelectConnection(connectionId);
//     the screen does not switch itself, the caller re-targets it

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/docs' } },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockResolvedValue({
        connections: CONNECTIONS,
        backupByConnection: { c1: { sources: ['/mnt/user/media/photos'], localDest: 'D:\\Backups' } },
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => { delete window.winraid })

function picker(name) {
  return screen.getByRole('button', { name: `Connection: ${name}` })
}

async function choose(name) {
  await act(async () => { fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: new RegExp(name) })) })
}

describe('SizeView connection picker', () => {
  it('names the connection it is scanning and switches on demand', async () => {
    const onSelectConnection = vi.fn()
    render(
      <SizeView
        connectionId="c1"
        connection={CONNECTIONS[0]}
        connections={CONNECTIONS}
        onSelectConnection={onSelectConnection}
        onBrowsePath={vi.fn()}
      />,
    )
    await act(async () => {})
    expect(picker('Atlas')).toBeTruthy()
    fireEvent.click(picker('Atlas'))
    await choose('Vault')
    expect(onSelectConnection).toHaveBeenCalledWith('c2')
  })
})

describe('BackupView connection picker', () => {
  it('names the connection it is backing up and switches on demand', async () => {
    const onSelectConnection = vi.fn()
    render(
      <BackupView
        connectionId="c1"
        connections={CONNECTIONS}
        onSelectConnection={onSelectConnection}
        backupRun={{ runStatus: 'idle', stats: null, currentFile: null, lastRun: null }}
        setBackupRun={vi.fn()}
      />,
    )
    await act(async () => {})
    expect(picker('Atlas')).toBeTruthy()
    fireEvent.click(picker('Atlas'))
    await choose('Vault')
    expect(onSelectConnection).toHaveBeenCalledWith('c2')
  })
})
