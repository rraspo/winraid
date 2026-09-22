import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import OptionsPopover from './OptionsPopover'

// Contract under test — Options is a popover (role="menu", the same
// portal-positioned pattern EntryMenu's dropdown already uses), not a
// modal: no backdrop, anchored to the overflow button. Its content is
// exactly the card's list, in order, and every control is real (persists
// through the callbacks the parent wires to config), with no invented
// settings beyond that list.

const BROWSE_OPTIONS = {
  thumbnails: true,
  columns: { size: true, modified: true, kind: true },
  density: 'default',
  showHidden: false,
}

function Harness(props = {}) {
  const anchorRef = createRef()
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <OptionsPopover
        anchorRef={anchorRef}
        open
        onClose={vi.fn()}
        browseOptions={BROWSE_OPTIONS}
        onSetThumbnails={vi.fn()}
        onSetColumn={vi.fn()}
        onSetDensity={vi.fn()}
        onSetShowHidden={vi.fn()}
        sortPersistence="default"
        onSetSortPersistence={vi.fn()}
        onOpenSettings={vi.fn()}
        {...props}
      />
    </div>
  )
}

describe('OptionsPopover — shape', () => {
  it('renders nothing when closed', () => {
    const anchorRef = createRef()
    render(
      <div>
        <button ref={anchorRef}>anchor</button>
        <OptionsPopover
          anchorRef={anchorRef} open={false} onClose={vi.fn()}
          browseOptions={BROWSE_OPTIONS} onSetThumbnails={vi.fn()} onSetColumn={vi.fn()}
          onSetDensity={vi.fn()} onSetShowHidden={vi.fn()} sortPersistence="default"
          onSetSortPersistence={vi.fn()} onOpenSettings={vi.fn()}
        />
      </div>
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('is a popover (role menu), not a dialog', () => {
    render(<Harness />)
    expect(screen.getByRole('menu', { name: 'Browse options' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists Thumbnails, columns, Density, Show hidden files, sort scope, then All settings, in order', () => {
    render(<Harness />)
    const menu = screen.getByRole('menu')
    const text = menu.textContent
    const order = ['Thumbnails', 'Size', 'Modified', 'Kind', 'Density', 'Show hidden files', 'Remember this sort for', 'All settings']
    let lastIndex = -1
    for (const label of order) {
      const idx = text.indexOf(label)
      expect(idx).toBeGreaterThan(lastIndex)
      lastIndex = idx
    }
  })
})

describe('OptionsPopover — controls', () => {
  it('toggles thumbnails', () => {
    const onSetThumbnails = vi.fn()
    render(<Harness onSetThumbnails={onSetThumbnails} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Thumbnails' }))
    expect(onSetThumbnails).toHaveBeenCalledWith(false)
  })

  it('toggles each column independently', () => {
    const onSetColumn = vi.fn()
    render(<Harness onSetColumn={onSetColumn} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Size' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Modified' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kind' }))
    expect(onSetColumn).toHaveBeenCalledWith('size', false)
    expect(onSetColumn).toHaveBeenCalledWith('modified', false)
    expect(onSetColumn).toHaveBeenCalledWith('kind', false)
  })

  it('changes density via the segmented control', () => {
    const onSetDensity = vi.fn()
    render(<Harness onSetDensity={onSetDensity} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Compact' }))
    expect(onSetDensity).toHaveBeenCalledWith('compact')
  })

  it('toggles show hidden files', () => {
    const onSetShowHidden = vi.fn()
    render(<Harness onSetShowHidden={onSetShowHidden} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show hidden files' }))
    expect(onSetShowHidden).toHaveBeenCalledWith(true)
  })

  it('offers this folder / this connection / everywhere for the sort scope', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Remember this sort for' })
    const labels = within(group).getAllByRole('radio').map((r) => r.textContent)
    expect(labels).toEqual(['This folder', 'This connection', 'Everywhere'])
  })

  it('changes the sort scope via the segmented control', () => {
    const onSetSortPersistence = vi.fn()
    render(<Harness onSetSortPersistence={onSetSortPersistence} />)
    fireEvent.click(screen.getByRole('radio', { name: 'This connection' }))
    expect(onSetSortPersistence).toHaveBeenCalledWith('connection')
  })

  it('navigates to settings from All settings…', () => {
    const onOpenSettings = vi.fn()
    render(<Harness onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'All settings…' }))
    expect(onOpenSettings).toHaveBeenCalled()
  })
})

describe('OptionsPopover — dismissal', () => {
  it('closes on outside click', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on a click inside the popover', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
