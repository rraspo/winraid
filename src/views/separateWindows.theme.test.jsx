import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import TrayFlyout from './TrayFlyout'
import WhatsNew from './WhatsNew'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the windows that render without App (the tray
// flyout and What's New, each a separate BrowserWindow on its own hash) wear
// the saved appearance too.
//
// Only App set data-theme and the accent, and tokens.css defaults :root to
// the dark palette, so both windows stayed dark with the default accent
// whatever the user chose. The tray flyout's window lives for the whole
// session and is only hidden between opens, so it also re-reads the
// appearance whenever it regains focus, picking up a change made in
// Settings meanwhile.

function mockAppearance(appearance) {
  const get = vi.fn().mockImplementation((key) => {
    if (key === 'appearance') return Promise.resolve(appearance.current)
    if (key === 'connections') return Promise.resolve([])
    return Promise.resolve({ connections: [] })
  })
  window.winraid = createWinraidMock({ config: { get } })
}

afterEach(() => {
  delete window.winraid
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('--accent')
  document.documentElement.style.removeProperty('--onAccent')
})

describe.each([
  ['TrayFlyout', TrayFlyout],
  ['WhatsNew', WhatsNew],
])('%s follows the saved appearance', (_name, View) => {
  it('applies a light theme and the chosen accent', async () => {
    mockAppearance({ current: { theme: 'light', accent: 'magenta' } })
    render(<View />)
    await act(async () => {})
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--accent').toLowerCase()).toBe('#c239b3')
  })

  it('applies a dark theme', async () => {
    mockAppearance({ current: { theme: 'dark', accent: 'system' } })
    render(<View />)
    await act(async () => {})
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('TrayFlyout picks up an appearance change made while hidden', () => {
  it('re-reads the appearance when its window regains focus', async () => {
    const appearance = { current: { theme: 'dark', accent: 'system' } }
    mockAppearance(appearance)
    render(<TrayFlyout />)
    await act(async () => {})
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    appearance.current = { theme: 'light', accent: 'system' }
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
