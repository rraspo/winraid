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
//
// The menu also carries the cross-connection favourites list below a
// divider — the picker takes a pre-ordered `favorites` array and renders it
// as-is; ordering (open connection first) is the caller's job, not this
// component's.

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

describe('ConnectionPicker — cross-connection favourites', () => {
  const FAVORITES = [
    { connectionId: 'c1', path: '/mnt/user/media/photos' },
    { connectionId: 'c2', path: '/mnt/user/docs/Invoices' },
  ]

  it('has no divider or favourites section when there are none', () => {
    mount()
    fireEvent.click(trigger())
    const menu = screen.getByRole('menu')
    expect(menu.querySelector('.divider')).toBeNull()
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3)
  })

  it('shows a divider below the connection list, followed by the favourites, each as folder name + connection name', () => {
    mount({ favorites: FAVORITES })
    fireEvent.click(trigger())
    const menu = screen.getByRole('menu')
    expect(menu.querySelector('.divider')).toBeTruthy()
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(5)
    const favItems = items.slice(3)
    expect(favItems.map((item) => item.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'photos Atlas',
      'Invoices Vault',
    ])
  })

  it('picking a favourite calls onSelectFavorite with its connection and path, and closes the menu', () => {
    const onSelectFavorite = vi.fn()
    mount({ favorites: FAVORITES, onSelectFavorite })
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: /Invoices/ }))
    expect(onSelectFavorite).toHaveBeenCalledWith('c2', '/mnt/user/docs/Invoices')
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
