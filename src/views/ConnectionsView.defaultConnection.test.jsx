import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ConnectionsView from './ConnectionsView'

// Contract under test — the default connection is chosen where the
// connections are.
//
// Which connection browse, play, backup and size open on was settable only
// in Settings, several screens away from the cards that show every
// connection side by side. The Connections screen is where that comparison
// already happens, so the choice belongs on the cards themselves.
//
// DOM contract, per connection card:
//   - a control named "Make <name> the default connection" that calls
//     onSetDefault(<id>)
//   - the card that is the default says so, and its control instead offers
//     to clear it, calling onSetDefault(null) — clearing returns to "last
//     used", the same value Settings writes
//   - the control reflects the current default with aria-pressed

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', operation: 'copy', folderMode: 'mirror', sftp: { host: 'nas.local', remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', type: 'sftp', localFolder: 'C:\\docs', operation: 'copy', folderMode: 'flat',   sftp: { host: 'nas.local', remotePath: '/mnt/user/docs' } },
]

function setup(overrides = {}) {
  const onSetDefault = vi.fn()
  render(
    <ConnectionsView
      connections={CONNECTIONS}
      watcherStatuses={{ c1: { watching: true }, c2: { watching: false } }}
      onEditConnection={vi.fn()}
      onOpenTab={vi.fn()}
      onStartWatching={vi.fn()}
      onStopWatching={vi.fn()}
      defaultConnectionId={null}
      onSetDefault={onSetDefault}
      {...overrides}
    />,
  )
  return { onSetDefault }
}

function card(name) {
  return screen.getByRole('article', { name })
}

describe('choosing the default connection from the connections screen', () => {
  it('offers to make a connection the default', () => {
    const { onSetDefault } = setup()
    fireEvent.click(within(card('Vault')).getByRole('button', { name: 'Make Vault the default connection' }))
    expect(onSetDefault).toHaveBeenCalledWith('c2')
  })

  it('shows which connection is the default', () => {
    setup({ defaultConnectionId: 'c1' })
    expect(within(card('Atlas')).getByRole('button', { name: /default/i }).getAttribute('aria-pressed')).toBe('true')
    expect(within(card('Vault')).getByRole('button', { name: /default/i }).getAttribute('aria-pressed')).toBe('false')
  })

  it('lets the default be cleared back to last used', () => {
    const { onSetDefault } = setup({ defaultConnectionId: 'c1' })
    fireEvent.click(within(card('Atlas')).getByRole('button', { name: 'Stop Atlas being the default connection' }))
    expect(onSetDefault).toHaveBeenCalledWith(null)
  })

  it('moves the default from one connection to another', () => {
    const { onSetDefault } = setup({ defaultConnectionId: 'c1' })
    fireEvent.click(within(card('Vault')).getByRole('button', { name: 'Make Vault the default connection' }))
    expect(onSetDefault).toHaveBeenCalledWith('c2')
  })
})
