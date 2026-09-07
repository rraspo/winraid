import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TabBar from './TabBar'

// Contract under test — with several tabs of the same connection and kind
// open at once, the strip has to tell them apart, and middle-clicking one
// closes it.
//
//   - a tab renders its own `label` when it has one, so two browse tabs on
//     the same connection read as their folders rather than twice the same
//     connection name
//   - a tab with no label falls back to the connection's name
//   - middle click closes the tab under the cursor

const CONNECTIONS = [{ id: 'c1', name: 'Atlas', icon: null }]

const TABS = [
  { id: 't1', connId: 'c1', type: 'browse', label: 'Documents' },
  { id: 't2', connId: 'c1', type: 'browse', label: 'Photos' },
  { id: 't3', connId: 'c1', type: 'size' },
]

function mount(props = {}) {
  const onActivate = vi.fn()
  const onClose    = vi.fn()
  render(
    <TabBar
      openTabs={TABS}
      activeTabId="t1"
      connections={CONNECTIONS}
      dirtyTabs={new Set()}
      onActivate={onActivate}
      onClose={onClose}
      {...props}
    />,
  )
  return { onActivate, onClose }
}

function tab(id) {
  return document.querySelector(`[data-tabid="${id}"]`)
}

describe('TabBar with several tabs of one connection', () => {
  it('tells two tabs of the same connection apart by their labels', () => {
    mount()
    expect(tab('t1').textContent).toContain('Documents')
    expect(tab('t2').textContent).toContain('Photos')
    expect(tab('t1').textContent).not.toContain('Photos')
  })

  it('falls back to the connection name when a tab has no label', () => {
    mount()
    expect(tab('t3').textContent).toContain('Atlas')
  })

  it('closes the tab under a middle click', () => {
    const { onClose, onActivate } = mount()
    fireEvent.mouseDown(tab('t2'), { button: 1 })
    expect(onClose).toHaveBeenCalledWith('t2')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('activates on a plain click', () => {
    const { onActivate } = mount()
    fireEvent.click(tab('t2'))
    expect(onActivate).toHaveBeenCalledWith('t2')
  })

  it('keeps the close button working', () => {
    const { onClose } = mount()
    fireEvent.click(within(tab('t2')).getByRole('button'))
    expect(onClose).toHaveBeenCalledWith('t2')
  })
})

function within(element) {
  return {
    getByRole: (role) => {
      const found = element.querySelector(role === 'button' ? 'button' : `[role="${role}"]`)
      if (!found) throw new Error(`no ${role} in tab`)
      return found
    },
  }
}
