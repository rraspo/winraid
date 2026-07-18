import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
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

describe('EntryMenu — Reveal in Explorer (local mirror)', () => {
  it('shows the reveal item when a local candidate exists', async () => {
    const checkLocalExists = vi.fn().mockResolvedValue(true)
    render(
      <EntryMenu
        {...baseProps}
        isDir
        localCandidate={'Z:\\winraid\\media\\photos'}
        checkLocalExists={checkLocalExists}
        onRevealLocal={noop}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Reveal in Explorer')).toBeInTheDocument()
    expect(checkLocalExists).toHaveBeenCalledWith('Z:\\winraid\\media\\photos')
  })

  it('hides the reveal item when there is no local candidate', () => {
    render(<EntryMenu {...baseProps} isDir localCandidate={null} checkLocalExists={vi.fn()} onRevealLocal={noop} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Reveal in Explorer')).toBeNull()
  })

  it('hides the reveal item when the local copy does not exist', async () => {
    const checkLocalExists = vi.fn().mockResolvedValue(false)
    render(
      <EntryMenu
        {...baseProps}
        isDir
        localCandidate={'Z:\\winraid\\media\\photos'}
        checkLocalExists={checkLocalExists}
        onRevealLocal={noop}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(checkLocalExists).toHaveBeenCalled())
    expect(screen.queryByText('Reveal in Explorer')).toBeNull()
  })

  it('calls onRevealLocal with the candidate when clicked', async () => {
    const onRevealLocal = vi.fn()
    render(
      <EntryMenu
        {...baseProps}
        isDir
        localCandidate={'Z:\\winraid\\media\\photos'}
        checkLocalExists={vi.fn().mockResolvedValue(true)}
        onRevealLocal={onRevealLocal}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(await screen.findByText('Reveal in Explorer'))
    expect(onRevealLocal).toHaveBeenCalledWith('Z:\\winraid\\media\\photos')
  })
})
