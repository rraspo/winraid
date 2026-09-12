import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ConnectionPicker from './ConnectionPicker'

// Contract under test — the switcher can also say which connection to come
// back to.
//
// The picker is where you change connection on browse, play, backup and
// size. Switching there is a one-off; naming the one these screens should
// open on by default was a trip to Settings. Both now live in the same menu.
//
// Switching and pinning stay separate controls, so choosing a connection
// never silently changes the default and pinning one never drags you onto
// it. The existing menu contract is untouched: one role="menuitem" per
// connection, the active one carrying aria-current.
//
// DOM contract, per row:
//   - a role="menuitemradio" named "Make <name> the default connection",
//     aria-checked reflecting the current default, calling
//     onSetDefault(<id>)
//   - the pinned row offers to clear instead, calling onSetDefault(null)
//   - pinning does not call onSelect

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', sftp: { remotePath: '/mnt/user/media' } },
  { id: 'c2', name: 'Vault', sftp: { remotePath: '/mnt/user/docs' } },
]

function setup(overrides = {}) {
  const onSelect     = vi.fn()
  const onSetDefault = vi.fn()
  render(
    <ConnectionPicker
      connections={CONNECTIONS}
      connectionId="c1"
      onSelect={onSelect}
      defaultConnectionId={null}
      onSetDefault={onSetDefault}
      {...overrides}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Connection: Atlas' }))
  return { onSelect, onSetDefault }
}

function menu() {
  return screen.getByRole('menu')
}

describe('setting the default connection from the picker', () => {
  it('offers to pin each connection', () => {
    const { onSetDefault } = setup()
    fireEvent.click(within(menu()).getByRole('menuitemradio', { name: 'Make Vault the default connection' }))
    expect(onSetDefault).toHaveBeenCalledWith('c2')
  })

  it('does not switch connection when pinning one', () => {
    const { onSelect, onSetDefault } = setup()
    fireEvent.click(within(menu()).getByRole('menuitemradio', { name: 'Make Vault the default connection' }))
    expect(onSetDefault).toHaveBeenCalledWith('c2')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('marks the pinned connection', () => {
    setup({ defaultConnectionId: 'c2' })
    const radios = within(menu()).getAllByRole('menuitemradio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true'])
  })

  it('clears the default back to last used', () => {
    const { onSetDefault } = setup({ defaultConnectionId: 'c1' })
    fireEvent.click(within(menu()).getByRole('menuitemradio', { name: 'Stop Atlas being the default connection' }))
    expect(onSetDefault).toHaveBeenCalledWith(null)
  })

  it('leaves switching alone', () => {
    const { onSelect } = setup()
    fireEvent.click(within(menu()).getByRole('menuitem', { name: /Vault/ }))
    expect(onSelect).toHaveBeenCalledWith('c2')
  })

  it('keeps one menuitem per connection', () => {
    setup()
    expect(within(menu()).getAllByRole('menuitem')).toHaveLength(2)
  })
})
