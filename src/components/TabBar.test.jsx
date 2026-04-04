import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TabBar from './TabBar'

vi.mock('./ConnectionIcon', () => ({ default: () => null }))

const CONNECTIONS = [
  { id: 'conn-1', name: 'Home NAS', icon: null, type: 'sftp' },
  { id: 'conn-2', name: 'Backup',   icon: null, type: 'smb'  },
]

const TABS = [
  { id: 'conn-1:browse', connId: 'conn-1', type: 'browse' },
  { id: 'conn-2:browse', connId: 'conn-2', type: 'browse' },
]

const TABS_WITH_BACKUP = [
  { id: 'conn-1:browse', connId: 'conn-1', type: 'browse' },
  { id: 'conn-1:backup', connId: 'conn-1', type: 'backup' },
]

describe('TabBar', () => {
  it('renders nothing when openTabs is empty', () => {
    const { container } = render(
      <TabBar openTabs={[]} activeTabId={null} connections={CONNECTIONS} onActivate={vi.fn()} onClose={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders one tab per entry', () => {
    render(
      <TabBar openTabs={TABS} activeTabId="conn-1:browse" connections={CONNECTIONS} onActivate={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('Home NAS')).toBeInTheDocument()
    expect(screen.getByText('Backup')).toBeInTheDocument()
  })

  it('calls onActivate with tab id when tab is clicked', () => {
    const onActivate = vi.fn()
    render(
      <TabBar openTabs={TABS} activeTabId="conn-1:browse" connections={CONNECTIONS} onActivate={onActivate} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByText('Backup').closest('[data-tabid]'))
    expect(onActivate).toHaveBeenCalledWith('conn-2:browse')
  })

  it('applies tabActive class to the active tab only', () => {
    const { container } = render(
      <TabBar openTabs={TABS} activeTabId="conn-1:browse" connections={CONNECTIONS} onActivate={vi.fn()} onClose={vi.fn()} />
    )
    const activeEl   = container.querySelector('[data-tabid="conn-1:browse"]')
    const inactiveEl = container.querySelector('[data-tabid="conn-2:browse"]')
    expect(activeEl.className).toContain('tabActive')
    expect(inactiveEl.className).not.toContain('tabActive')
  })

  it('renders browse and backup type labels', () => {
    render(
      <TabBar openTabs={TABS_WITH_BACKUP} activeTabId="conn-1:browse" connections={CONNECTIONS} onActivate={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText('browse')).toBeInTheDocument()
    expect(screen.getByText('backup')).toBeInTheDocument()
  })

  it('calls onClose with tab id when close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <TabBar openTabs={TABS} activeTabId="conn-1:browse" connections={CONNECTIONS} onActivate={vi.fn()} onClose={onClose} />
    )
    const closeButtons = screen.getAllByTitle('Close tab')
    fireEvent.click(closeButtons[0])
    expect(onClose).toHaveBeenCalledWith('conn-1:browse')
  })
})
