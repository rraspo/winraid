import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ConnectionPicker from './ConnectionPicker'

// Contract under test — the connection picker the design puts in the
// browser toolbar, extracted so every screen that shows one connection's
// data can carry it. Nothing chooses a connection silently any more: the
// picker names the connection on screen and switches it in place.
//
// DOM contract:
//   - a button named "Connection: <name>" showing the name and the
//     connection's remote root
//   - clicking it opens a <div role="menu"> with one role="menuitem" per
//     connection, each showing the name and the remote root, the open one
//     carrying aria-current="true"
//   - choosing an entry calls onSelect(connectionId) and closes the menu
//   - choosing the connection already open closes the menu without calling
//     onSelect
//   - with a single connection there is no menu: the name renders as plain
//     text, not a button

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', type: 'sftp', sftp: { remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', type: 'sftp', sftp: { remotePath: '/mnt/user/docs' } },
  { id: 'c3', name: 'Media', type: 'smb',  smb:  { remotePath: '/media/inbox' } },
]

function mount(props = {}) {
  const onSelect = vi.fn()
  render(<ConnectionPicker connections={CONNECTIONS} connectionId="c1" onSelect={onSelect} {...props} />)
  return { onSelect }
}

function trigger(name = 'Atlas') {
  return screen.getByRole('button', { name: `Connection: ${name}` })
}

describe('ConnectionPicker', () => {
  it('names the open connection and shows its remote root', () => {
    mount()
    expect(trigger().textContent).toContain('Atlas')
    expect(trigger().textContent).toContain('/mnt/user/media')
  })

  it('lists every connection with its root and marks the open one', () => {
    mount()
    fireEvent.click(trigger())
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Atlas /mnt/user/media',
      'Vault /mnt/user/docs',
      'Media /media/inbox',
    ])
    expect(items[0].getAttribute('aria-current')).toBe('true')
    expect(items[1].getAttribute('aria-current')).toBeNull()
  })

  it('switches to the chosen connection and closes', () => {
    const { onSelect } = mount()
    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Vault/ }))
    expect(onSelect).toHaveBeenCalledWith('c2')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('choosing the open connection changes nothing', () => {
    const { onSelect } = mount()
    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Atlas/ }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('is a plain label when there is only one connection', () => {
    mount({ connections: [CONNECTIONS[0]] })
    expect(screen.queryByRole('button', { name: /^Connection:/ })).toBeNull()
    expect(screen.getByText('Atlas')).toBeTruthy()
  })

  it('says so when the connection is unknown', () => {
    mount({ connectionId: null })
    expect(screen.getByRole('button', { name: 'Connection: none' })).toBeTruthy()
  })
})
