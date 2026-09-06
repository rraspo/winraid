import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ConnectionsView from './ConnectionsView'

// Contract under test — the Connections screen takes over what the old
// sidebar's connection list did: see every connection, open its browser,
// edit it, or add a new one. The full prototype styling and the wizard
// come with the connections card; this is the screen's behavior.
//
// DOM contract:
//   - heading "Connections"
//   - a button "Add connection" calling onEditConnection(null)
//   - one <article aria-label="<name>"> per connection showing its name,
//     protocol (SFTP or SMB, from connection.type), local folder and remote
//     path, and a watcher status word (Watching / Paused / Stopped) from
//     watcherStatuses[connection.id]
//   - inside each article: "Browse" calls onOpenTab(id, 'browse'),
//     "Edit" calls onEditConnection(connection)
//   - an empty list shows "No connections yet"

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\Users\\user\\Pictures', sftp: { host: 'nas.local', remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', type: 'smb',  localFolder: 'C:\\Users\\user\\Documents', smb: { share: '\\\\10.0.0.1\\docs', remotePath: '/docs' } },
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

describe('ConnectionsView', () => {
  it('lists every connection with its protocol, paths and watcher state', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Connections' })).toBeTruthy()
    const atlas = card('Atlas')
    expect(atlas.textContent).toContain('SFTP')
    expect(atlas.textContent).toContain('C:\\Users\\user\\Pictures')
    expect(atlas.textContent).toContain('/mnt/user/media')
    expect(atlas.textContent).toContain('Watching')
    const vault = card('Vault')
    expect(vault.textContent).toContain('SMB')
    expect(vault.textContent).toContain('Stopped')
  })

  it('opens the browser for a connection', () => {
    const { onOpenTab } = mount()
    fireEvent.click(within(card('Vault')).getByRole('button', { name: 'Browse' }))
    expect(onOpenTab).toHaveBeenCalledWith('c2', 'browse')
  })

  it('edits a connection and adds a new one through the same callback', () => {
    const { onEditConnection } = mount()
    fireEvent.click(within(card('Atlas')).getByRole('button', { name: 'Edit' }))
    expect(onEditConnection).toHaveBeenCalledWith(CONNECTIONS[0])
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    expect(onEditConnection).toHaveBeenLastCalledWith(null)
  })

  it('shows an empty state without connections', () => {
    mount({ connections: [] })
    expect(screen.getByText('No connections yet')).toBeTruthy()
    expect(screen.queryAllByRole('article')).toHaveLength(0)
  })
})
