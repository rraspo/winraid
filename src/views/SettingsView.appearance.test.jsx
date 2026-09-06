import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import SettingsView from './SettingsView'
import { createWinraidMock } from '../__mocks__/winraid'
import { ACCENT_PALETTE } from '../utils/accent'

// Contract under test — Settings gains an Appearance card that owns the
// theme and the accent. Nothing here is tied to one color: the accent is
// either the Windows system accent or one of the palette swatches, and the
// choice is persisted under the `appearance` config key.
//
// DOM contract:
//   - a heading "Appearance"
//   - a radiogroup labelled "Theme" with radios "System", "Dark", "Light"
//     reflecting appearance.theme; choosing one writes
//     config.set('appearance', { ...current, theme })
//   - an accent row: <button aria-label="System accent" aria-pressed>
//     carrying data-accent="<hex>" with the live system accent, disabled
//     (with an explanation) when the platform reports none; then one
//     <button aria-label="<Label> accent" aria-pressed data-accent="<hex>">
//     per ACCENT_PALETTE entry; choosing one writes
//     config.set('appearance', { ...current, accent: <id> })

function setup({ appearance = {}, systemAccent = '#0078D4' } = {}) {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'appearance') return Promise.resolve(appearance)
        if (key === 'playDefaults') return Promise.resolve({ recursive: true, shuffle: false })
        return Promise.resolve({})
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
  window.winraid.system = {
    accentColor:          vi.fn().mockResolvedValue(systemAccent),
    onAccentColorChanged: vi.fn().mockReturnValue(() => {}),
  }
}

async function mount() {
  render(<SettingsView />)
  await act(async () => {})
}

function themeGroup() {
  return screen.getByRole('radiogroup', { name: 'Theme' })
}

function systemAccentButton() {
  return screen.getByRole('button', { name: 'System accent' })
}

function swatch(label) {
  return screen.getByRole('button', { name: `${label} accent` })
}

beforeEach(() => setup())
afterEach(() => { delete window.winraid; localStorage.clear() })

describe('SettingsView — Appearance', () => {
  it('renders the Appearance card with the theme control and the accent row', async () => {
    await mount()
    expect(screen.getByText('Appearance')).toBeTruthy()
    const group = themeGroup()
    expect(within(group).getByRole('radio', { name: 'System' })).toBeTruthy()
    expect(within(group).getByRole('radio', { name: 'Dark' })).toBeTruthy()
    expect(within(group).getByRole('radio', { name: 'Light' })).toBeTruthy()
    expect(systemAccentButton()).toBeTruthy()
    for (const entry of ACCENT_PALETTE) {
      expect(swatch(entry.label).getAttribute('data-accent')).toBe(entry.hex)
    }
  })

  it('defaults to System theme and System accent when nothing is stored', async () => {
    await mount()
    expect(within(themeGroup()).getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    expect(systemAccentButton().getAttribute('aria-pressed')).toBe('true')
    expect(swatch('Orange').getAttribute('aria-pressed')).toBe('false')
  })

  it('reflects a stored theme and accent', async () => {
    setup({ appearance: { theme: 'light', accent: 'teal' } })
    await mount()
    expect(within(themeGroup()).getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    expect(swatch('Teal').getAttribute('aria-pressed')).toBe('true')
    expect(systemAccentButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('choosing a theme writes it under appearance and keeps the accent', async () => {
    setup({ appearance: { theme: 'system', accent: 'teal' } })
    await mount()
    fireEvent.click(within(themeGroup()).getByRole('radio', { name: 'Dark' }))
    expect(window.winraid.config.set).toHaveBeenCalledWith('appearance', { theme: 'dark', accent: 'teal' })
    expect(within(themeGroup()).getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
  })

  it('choosing a swatch writes its id under appearance and keeps the theme', async () => {
    setup({ appearance: { theme: 'light', accent: 'system' } })
    await mount()
    fireEvent.click(swatch('Teal'))
    expect(window.winraid.config.set).toHaveBeenCalledWith('appearance', { theme: 'light', accent: 'teal' })
    expect(swatch('Teal').getAttribute('aria-pressed')).toBe('true')
    expect(systemAccentButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('choosing System accent writes system', async () => {
    setup({ appearance: { theme: 'dark', accent: 'orange' } })
    await mount()
    fireEvent.click(systemAccentButton())
    expect(window.winraid.config.set).toHaveBeenCalledWith('appearance', { theme: 'dark', accent: 'system' })
  })

  it('shows the live system accent on the System swatch', async () => {
    setup({ systemAccent: '#10893E' })
    await mount()
    expect(systemAccentButton().getAttribute('data-accent')).toBe('#10893E')
    expect(systemAccentButton().disabled).toBe(false)
  })

  it('disables the System swatch with an explanation when the platform has no accent', async () => {
    setup({ systemAccent: null })
    await mount()
    expect(systemAccentButton().disabled).toBe(true)
    expect(systemAccentButton().getAttribute('title')).toMatch(/system accent/i)
  })

  it('never writes a raw hex as the accent choice', async () => {
    await mount()
    fireEvent.click(swatch('Orange'))
    const [, written] = window.winraid.config.set.mock.calls.find(([key]) => key === 'appearance')
    expect(written.accent).toBe('orange')
    expect(written.accent).not.toMatch(/^#/)
  })
})
