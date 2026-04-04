import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Sidebar from './Sidebar'

vi.mock('../../assets/winraid_icon_64x64.png', () => ({ default: '' }))
vi.mock('./ConnectionIcon', () => ({ default: () => null }))
vi.mock('./ui/Tooltip', () => ({ default: ({ children }) => children }))

// Sidebar calls window.winraid.getVersion — stub it
// Default-open accordion is disabled so each test controls expand state explicitly
beforeEach(() => {
  window.winraid = { getVersion: vi.fn().mockResolvedValue('1.0.0') }
  localStorage.setItem('sidebar-accordions-default-open', 'false')
})

afterEach(() => {
  localStorage.clear()
})

const CONNECTIONS = [
  { id: 'c1', name: 'Home NAS', icon: null, type: 'sftp' },
  { id: 'c2', name: 'Backup',   icon: null, type: 'smb'  },
]

function renderSidebar(props = {}) {
  return render(
    <Sidebar
      activeView="dashboard"
      onNavigate={vi.fn()}
      theme="dark"
      onThemeToggle={vi.fn()}
      onEditConnection={vi.fn()}
      connections={CONNECTIONS}
      openTabs={[]}
      activeTabId={null}
      onOpenTab={vi.fn()}
      editingConnId={null}
      watcherStatuses={{}}
      {...props}
    />
  )
}

describe('Sidebar accordion', () => {
  it('renders a header row for each connection', () => {
    renderSidebar()
    expect(screen.getByText('Home NAS')).toBeInTheDocument()
    expect(screen.getByText('Backup')).toBeInTheDocument()
  })

  it('shows sub-items when accordion is expanded', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('Home NAS').closest('button'))
    expect(screen.getByText('Browse')).toBeInTheDocument()
  })

  it('calls onOpenTab with correct args when Browse sub-item is clicked', () => {
    const onOpenTab = vi.fn()
    renderSidebar({ onOpenTab })
    fireEvent.click(screen.getByText('Home NAS').closest('button'))
    fireEvent.click(screen.getByText('Browse'))
    expect(onOpenTab).toHaveBeenCalledWith('c1', 'browse')
  })

  it('calls onOpenTab with backup type when Backup sub-item is clicked', () => {
    const onOpenTab = vi.fn()
    renderSidebar({ onOpenTab })
    fireEvent.click(screen.getByText('Home NAS').closest('button'))
    fireEvent.click(screen.getByTestId('sub-backup-c1'))
    expect(onOpenTab).toHaveBeenCalledWith('c1', 'backup')
  })

  it('calls onEditConnection when Edit Connection sub-item is clicked', () => {
    const onEditConnection = vi.fn()
    renderSidebar({ onEditConnection })
    fireEvent.click(screen.getByText('Home NAS').closest('button'))
    fireEvent.click(screen.getByTestId('sub-edit-c1'))
    expect(onEditConnection).toHaveBeenCalledWith(CONNECTIONS[0])
  })

  it('hides sub-items when accordion is collapsed again', () => {
    renderSidebar()
    const header = screen.getByText('Home NAS').closest('button')
    fireEvent.click(header) // expand
    fireEvent.click(header) // collapse
    expect(screen.queryByTestId('sub-browse-c1')).not.toBeInTheDocument()
  })

  it('calls onOpenTab with size type when Size sub-item is clicked', () => {
    const onOpenTab = vi.fn()
    renderSidebar({ onOpenTab })
    fireEvent.click(screen.getByText('Home NAS').closest('button'))
    fireEvent.click(screen.getByTestId('sub-size-c1'))
    expect(onOpenTab).toHaveBeenCalledWith('c1', 'size')
  })

  it('does not show Backup in NAV_TOP', () => {
    renderSidebar()
    // NAV_TOP items render with navItem class — check none of them say "Backup"
    const navItems = document.querySelectorAll('nav > div > button')
    const labels = [...navItems].map((b) => b.textContent)
    expect(labels.some((l) => l.includes('Backup') && !l.includes('NAS'))).toBe(false)
  })
})
