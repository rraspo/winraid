import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ConnectionsView from './ConnectionsView'

// Contract under test — each connection can be started and stopped on its
// own.
//
// The Connections screen reported whether a connection was watching and gave
// no way to change it. The only controls were global: "Pause all" and
// "Resume all". Turning one connection off, or bringing one back after it had
// stopped, was not possible from anywhere in the app.
//
// DOM contract, per connection card:
//   - a watching connection offers "Stop watching <name>", calling
//     onStopWatching(<id>)
//   - a stopped or paused connection offers "Start watching <name>", calling
//     onStartWatching(<id>)
//   - a connection with no watch folder configured offers neither, and says
//     why, because starting it could not work

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas',   type: 'sftp', localFolder: 'C:\\sync',  operation: 'copy', folderMode: 'mirror', sftp: { host: 'nas.local', remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault',   type: 'sftp', localFolder: 'C:\\docs',  operation: 'copy', folderMode: 'flat',   sftp: { host: 'nas.local', remotePath: '/mnt/user/docs' } },
  { id: 'c3', name: 'Archive', type: 'sftp', localFolder: '',          operation: 'copy', folderMode: 'flat',   sftp: { host: 'nas.local', remotePath: '/archive' } },
]

const STATUSES = {
  c1: { watching: true,  state: 'idle' },
  c2: { watching: false, state: 'stopped' },
}

function setup(overrides = {}) {
  const onStartWatching = vi.fn()
  const onStopWatching  = vi.fn()
  render(
    <ConnectionsView
      connections={CONNECTIONS}
      watcherStatuses={STATUSES}
      onEditConnection={vi.fn()}
      onOpenTab={vi.fn()}
      onStartWatching={onStartWatching}
      onStopWatching={onStopWatching}
      {...overrides}
    />,
  )
  return { onStartWatching, onStopWatching }
}

function card(name) {
  return screen.getByRole('article', { name })
}

describe('per-connection watcher control', () => {
  it('offers to stop a connection that is watching', () => {
    const { onStopWatching } = setup()
    fireEvent.click(within(card('Atlas')).getByRole('button', { name: 'Stop watching Atlas' }))
    expect(onStopWatching).toHaveBeenCalledWith('c1')
  })

  it('offers to start a connection that is stopped', () => {
    const { onStartWatching } = setup()
    fireEvent.click(within(card('Vault')).getByRole('button', { name: 'Start watching Vault' }))
    expect(onStartWatching).toHaveBeenCalledWith('c2')
  })

  it('offers only the one that applies', () => {
    setup()
    expect(within(card('Atlas')).queryByRole('button', { name: 'Start watching Atlas' })).toBeNull()
    expect(within(card('Vault')).queryByRole('button', { name: 'Stop watching Vault' })).toBeNull()
  })

  it('offers to start a connection that is merely paused', () => {
    const { onStartWatching } = setup({ watcherStatuses: { c1: { watching: false, state: 'paused' } } })
    fireEvent.click(within(card('Atlas')).getByRole('button', { name: 'Start watching Atlas' }))
    expect(onStartWatching).toHaveBeenCalledWith('c1')
  })

  it('says why a connection without a watch folder cannot be started', () => {
    setup()
    expect(within(card('Archive')).queryByRole('button', { name: /watching Archive/ })).toBeNull()
    expect(card('Archive').textContent).toContain('No watch folder')
  })
})
