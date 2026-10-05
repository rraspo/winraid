import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWinraidMock } from '../__mocks__/winraid'
import BrowseView from './BrowseView'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'
import { resetTooltipWarmthForTests } from '../components/ui/tooltipWarmth'

vi.mock('../components/PlayOverlay', () => ({ default: () => <div data-testid="play-overlay" /> }))

// Contract under test — Sort and View in row 2's command bar:
//   - Sort's visible label is always the literal word "Sort", never the
//     current sort value (that only ever shows inside the open dropdown).
//   - Neither button carries a hover tooltip — their aria-label alone names
//     them, matching the icon+word+chevron buttons' own self-explanatory
//     shape.
//   - The active row in each dropdown is never color-only: it also carries
//     aria-current and a visible check-mark glyph.

const CONNECTIONS = [
  { id: 'conn-1', name: 'Atlas', type: 'sftp', localFolder: 'C:\\sync', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/data' } },
]

const ENTRIES = [
  { name: 'Documents', type: 'dir',  size: 0,     modified: Date.now() },
  { name: 'readme.txt', type: 'file', size: 1024, modified: Date.now() },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'connections') return Promise.resolve(CONNECTIONS)
        if (key === 'activeConnectionId') return Promise.resolve('conn-1')
        return Promise.resolve({ connections: CONNECTIONS, activeConnectionId: 'conn-1' })
      }),
    },
    remote: { list: vi.fn().mockResolvedValue({ ok: true, entries: ENTRIES }) },
  })
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('list')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  remoteFS.clearAll()
  toast.clearAll()
  delete window.winraid
  vi.restoreAllMocks()
})

async function mount(props = {}) {
  render(<BrowseView onHistoryPush={() => {}} connectionId="conn-1" onToggleFavorite={vi.fn()} {...props} />)
  await screen.findByText('readme.txt')
  await act(async () => {})
}

function commandRow() {
  return screen.getByRole('toolbar', { name: 'Browser commands' })
}

describe('Sort button label', () => {
  it('always reads "Sort", regardless of the active sort mode', async () => {
    const user = userEvent.setup()
    await mount()
    const sortBtn = within(commandRow()).getByRole('button', { name: 'Sort order' })
    expect(sortBtn.textContent).toBe('Sort')

    await user.click(sortBtn)
    await user.click(screen.getByText('Name Z-A'))

    expect(within(commandRow()).getByRole('button', { name: 'Sort order' }).textContent).toBe('Sort')
  })
})

describe('Sort and View have no redundant tooltip', () => {
  it('shows no tooltip bubble on hovering Sort', async () => {
    const user = userEvent.setup()
    await mount()
    const sortBtn = within(commandRow()).getByRole('button', { name: 'Sort order' })
    await user.hover(sortBtn)
    expect(screen.queryByText('Sort order')).toBeNull()
  })

  it('shows no tooltip bubble on hovering View', async () => {
    const user = userEvent.setup()
    await mount()
    const viewBtn = within(commandRow()).getByRole('button', { name: 'View' })
    await user.hover(viewBtn)
    // The only "View" text allowed is the button's own visible label.
    expect(screen.getAllByText('View')).toHaveLength(1)
  })

  it('still names the icon-only command buttons via their own tooltips', async () => {
    await mount()
    resetTooltipWarmthForTests()
    vi.useFakeTimers()
    try {
      const cutBtn = within(commandRow()).getByRole('button', { name: 'Cut' })
      fireEvent.mouseEnter(cutBtn.closest('.anchor'))
      // Past the cold-hover delay — see Tooltip.test.jsx for the timing contract.
      act(() => { vi.advanceTimersByTime(600) })
      expect(screen.getByText('Cut', { selector: 'div' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Selected option is marked by more than color', () => {
  it('marks the active Sort row with aria-current and a check-mark', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'Sort order' }))
    const activeOption = screen.getByText('Name A-Z').closest('button')
    expect(activeOption.getAttribute('aria-current')).toBe('true')
    expect(activeOption.querySelector('svg')).toBeTruthy()

    const inactiveOption = screen.getByText('Recent').closest('button')
    expect(inactiveOption.getAttribute('aria-current')).toBeFalsy()
  })

  it('marks the active View row with aria-current and a check-mark', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(within(commandRow()).getByRole('button', { name: 'View' }))
    const activeOption = screen.getByRole('menuitem', { name: /List view/ })
    expect(activeOption.getAttribute('aria-current')).toBe('true')
    // Two svgs: the mode icon and the added check-mark.
    expect(activeOption.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)

    const inactiveOption = screen.getByRole('menuitem', { name: /Grid view/ })
    expect(inactiveOption.getAttribute('aria-current')).toBeFalsy()
  })
})
