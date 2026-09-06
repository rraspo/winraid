import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ConnectionsView from './ConnectionsView'

// Contract under test — the Connections screen on the redesign, after
// ref/connections.png: a page header with a "New connection" action, then
// one card per connection carrying its identity, watch folder, remote
// path, rule tags and actions. Browse and Edit keep their callbacks (see
// ConnectionsView.test.jsx).
//
// DOM contract:
//   - <h1>Connections</h1> and the subtitle "Each watched folder pushes to
//     its own destination with its own rules"
//   - a button "New connection" calling onEditConnection(null)
//   - each card <article aria-label="<name>"> shows: the protocol badge
//     (SFTP / SMB), the host (sftp.host or smb.share), the watcher word,
//     two labeled blocks "Watch folder" and "Remote path" with the paths,
//     rule tags from the connection ("Copy" or "Move" from operation,
//     "Flat" / "Mirror" / "Mirror + clean" from folderMode, "Rename
//     duplicates" when renameDuplicates is on, and the extension filter
//     when extensions are set), and the actions "Browse files" (onOpenTab
//     id 'browse'), "Verify" and "Edit" (both onEditConnection(connection))
//   - "No connections yet" when the list is empty

const CONNECTIONS = [
  {
    id: 'c1', name: 'Atlas', type: 'sftp', operation: 'copy', folderMode: 'mirror', renameDuplicates: true,
    extensions: ['mp4', 'jpg'], localFolder: 'C:\\Users\\user\\Pictures\\Import',
    sftp: { host: 'nas.local', remotePath: '/mnt/user/media/incoming' },
  },
  {
    id: 'c2', name: 'Vault', type: 'smb', operation: 'move', folderMode: 'flat', renameDuplicates: false,
    extensions: [], localFolder: 'C:\\Users\\user\\Documents',
    smb: { share: '\\\\10.0.0.1\\docs', remotePath: '/docs' },
  },
]

function mount(props = {}) {
  const onEditConnection = vi.fn()
  const onOpenTab        = vi.fn()
  render(
    <ConnectionsView
      connections={CONNECTIONS}
      watcherStatuses={{ c1: { watching: true, state: 'idle' }, c2: { watching: false, state: 'idle' } }}
      onEditConnection={onEditConnection}
      onOpenTab={onOpenTab}
      {...props}
    />,
  )
  return { onEditConnection, onOpenTab }
}

function card(name) {
  return screen.getByRole('article', { name })
}

describe('ConnectionsView redesign', () => {
  it('has the title, the subtitle and the New connection action', () => {
    const { onEditConnection } = mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeTruthy()
    expect(screen.getByText('Each watched folder pushes to its own destination with its own rules')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New connection' }))
    expect(onEditConnection).toHaveBeenCalledWith(null)
  })

  it('shows identity, host, watcher word and the two path blocks on each card', () => {
    mount()
    const atlas = card('Atlas')
    expect(within(atlas).getByText('SFTP')).toBeTruthy()
    expect(within(atlas).getByText('nas.local')).toBeTruthy()
    expect(within(atlas).getByText('Watching')).toBeTruthy()
    expect(within(atlas).getByText('Watch folder')).toBeTruthy()
    expect(within(atlas).getByText('C:\\Users\\user\\Pictures\\Import')).toBeTruthy()
    expect(within(atlas).getByText('Remote path')).toBeTruthy()
    expect(within(atlas).getByText('/mnt/user/media/incoming')).toBeTruthy()
    const vault = card('Vault')
    expect(within(vault).getByText('SMB')).toBeTruthy()
    expect(within(vault).getByText('\\\\10.0.0.1\\docs')).toBeTruthy()
    expect(within(vault).getByText('Stopped')).toBeTruthy()
  })

  it('summarizes the rules as tags', () => {
    mount()
    const atlas = card('Atlas')
    expect(within(atlas).getByText('Copy')).toBeTruthy()
    expect(within(atlas).getByText('Mirror')).toBeTruthy()
    expect(within(atlas).getByText('Rename duplicates')).toBeTruthy()
    expect(within(atlas).getByText('mp4, jpg')).toBeTruthy()
    const vault = card('Vault')
    expect(within(vault).getByText('Move')).toBeTruthy()
    expect(within(vault).getByText('Flat')).toBeTruthy()
    expect(within(vault).queryByText('Rename duplicates')).toBeNull()
  })

  it('offers Browse files, Verify and Edit on each card', () => {
    const { onEditConnection, onOpenTab } = mount()
    fireEvent.click(within(card('Atlas')).getByRole('button', { name: 'Browse files' }))
    expect(onOpenTab).toHaveBeenCalledWith('c1', 'browse')
    fireEvent.click(within(card('Atlas')).getByRole('button', { name: 'Verify' }))
    expect(onEditConnection).toHaveBeenLastCalledWith(CONNECTIONS[0])
    fireEvent.click(within(card('Vault')).getByRole('button', { name: 'Edit' }))
    expect(onEditConnection).toHaveBeenLastCalledWith(CONNECTIONS[1])
  })
})
