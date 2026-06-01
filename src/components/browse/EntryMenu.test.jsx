import { describe, it, expect, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import EntryMenu from './EntryMenu'

afterEach(cleanup)

function noop() {}

const baseProps = {
  isDir: false,
  isEditable: false,
  busy: false,
  onDownload: noop,
  onEdit: noop,
  onMove: noop,
  onDelete: noop,
}

describe('EntryMenu — imperative openAt (right-click)', () => {
  it('opens the menu when openAt is called via ref', () => {
    const ref = createRef()
    render(<EntryMenu ref={ref} {...baseProps} />)

    expect(screen.queryByText('Move / Rename')).toBeNull()

    act(() => ref.current.openAt(100, 200))
    expect(screen.getByText('Move / Rename')).toBeInTheDocument()
    expect(screen.getByText('Download')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('positions the dropdown at the given coordinates', () => {
    const ref = createRef()
    render(<EntryMenu ref={ref} {...baseProps} />)
    act(() => ref.current.openAt(150, 250))
    const dropdown = screen.getByText('Move / Rename').closest('div')
    expect(dropdown.style.top).toBe('250px')
    expect(dropdown.style.left).toBe('150px')
  })

  it('still opens via the dot button click', () => {
    render(<EntryMenu {...baseProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Move / Rename')).toBeInTheDocument()
  })
})
