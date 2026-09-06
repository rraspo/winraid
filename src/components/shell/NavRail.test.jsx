import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import NavRail from './NavRail'

// Contract under test — the nav rail replaces the old sidebar as the app's
// only primary navigation: a 76px column of labeled icon buttons, the
// active one carrying the accent indicator.
//
// DOM contract:
//   - <nav aria-label="Primary">
//   - one <button> per item, in this order, named exactly:
//       Dashboard, Connections, Queue, Browse, Play wall, Size map, Backup,
//       Logs, then a spacer, then Tray (only when onOpenTray is given),
//       Theme, Settings
//   - the button whose view id equals activeView carries aria-current="page";
//     view ids: dashboard, connections, queue, browse, play, size, backup,
//     logs, settings
//   - clicking a view button calls onNavigate(viewId)
//   - Theme calls onThemeToggle; its title says which theme it switches to
//   - Tray calls onOpenTray

const NAV_ORDER = ['Dashboard', 'Connections', 'Queue', 'Browse', 'Play wall', 'Size map', 'Backup', 'Logs', 'Theme', 'Settings']
const VIEW_IDS  = {
  Dashboard: 'dashboard', Connections: 'connections', Queue: 'queue', Browse: 'browse',
  'Play wall': 'play', 'Size map': 'size', Backup: 'backup', Logs: 'logs', Settings: 'settings',
}

function mount(props = {}) {
  const onNavigate    = vi.fn()
  const onThemeToggle = vi.fn()
  render(
    <NavRail
      activeView="dashboard"
      onNavigate={onNavigate}
      theme="dark"
      onThemeToggle={onThemeToggle}
      {...props}
    />,
  )
  return { onNavigate, onThemeToggle }
}

function rail() {
  return screen.getByRole('navigation', { name: 'Primary' })
}

function buttonNames() {
  return within(rail()).getAllByRole('button').map((button) => button.textContent.trim())
}

describe('NavRail', () => {
  it('renders the primary navigation with every item in prototype order', () => {
    mount()
    expect(buttonNames()).toEqual(NAV_ORDER)
  })

  it('marks only the active view as current', () => {
    mount({ activeView: 'queue' })
    const current = within(rail()).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent.trim()).toBe('Queue')
  })

  it('marks nothing current when no view is active', () => {
    mount({ activeView: null })
    const current = within(rail()).getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(0)
  })

  it('navigates with the view id of the clicked item', () => {
    const { onNavigate } = mount()
    for (const [label, viewId] of Object.entries(VIEW_IDS)) {
      fireEvent.click(within(rail()).getByRole('button', { name: label }))
      expect(onNavigate).toHaveBeenLastCalledWith(viewId)
    }
    expect(onNavigate).toHaveBeenCalledTimes(Object.keys(VIEW_IDS).length)
  })

  it('offers the opposite theme and toggles on click', () => {
    const { onThemeToggle } = mount({ theme: 'dark' })
    const themeButton = within(rail()).getByRole('button', { name: 'Theme' })
    expect(themeButton.getAttribute('title')).toMatch(/light/i)
    fireEvent.click(themeButton)
    expect(onThemeToggle).toHaveBeenCalledTimes(1)
  })

  it('says it switches to dark when the theme is light', () => {
    mount({ theme: 'light' })
    expect(within(rail()).getByRole('button', { name: 'Theme' }).getAttribute('title')).toMatch(/dark/i)
  })

  it('shows a Tray item only when a tray opener is provided', () => {
    mount()
    expect(within(rail()).queryByRole('button', { name: 'Tray' })).toBeNull()
  })

  it('opens the tray from the Tray item, placed before Theme', () => {
    const onOpenTray = vi.fn()
    mount({ onOpenTray })
    const names = buttonNames()
    expect(names.indexOf('Tray')).toBe(names.indexOf('Theme') - 1)
    fireEvent.click(within(rail()).getByRole('button', { name: 'Tray' }))
    expect(onOpenTray).toHaveBeenCalledTimes(1)
  })
})
