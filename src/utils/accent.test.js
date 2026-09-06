import { describe, it, expect } from 'vitest'
import {
  ACCENT_PALETTE,
  DEFAULT_APPEARANCE,
  isAccentChoice,
  resolveAccentHex,
  onAccentTextColor,
  resolveTheme,
  normalizeAppearance,
} from './accent'

// Contract under test — the accent system behind Settings > Appearance.
// The app never hardcodes an accent: every accent-derived color in CSS is
// computed from the single `--accent` custom property, and this module is
// the only place that decides what that property holds.
//   - ACCENT_PALETTE: the fixed swatch set, [{ id, label, hex }], hex as
//     uppercase #RRGGBB; the prototype orange is the first entry and the
//     fallback when nothing else applies
//   - DEFAULT_APPEARANCE: { theme: 'system', accent: 'system' }
//   - isAccentChoice(value): 'system' or a palette id
//   - resolveAccentHex(choice, systemHex): the hex the app should apply
//   - onAccentTextColor(hex): '#FFFFFF' on dark accents, '#1B1B1B' on light
//   - resolveTheme(choice, systemPrefersDark): 'dark' | 'light'
//   - normalizeAppearance(raw): fills defaults, drops unknown values

describe('ACCENT_PALETTE', () => {
  it('starts with the prototype orange and offers at least eight distinct swatches', () => {
    expect(ACCENT_PALETTE.length).toBeGreaterThanOrEqual(8)
    expect(ACCENT_PALETTE[0]).toEqual({ id: 'orange', label: 'Orange', hex: '#CA5010' })
    const ids  = ACCENT_PALETTE.map((swatch) => swatch.id)
    const hexes = ACCENT_PALETTE.map((swatch) => swatch.hex)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(hexes).size).toBe(hexes.length)
  })

  it('stores every hex as uppercase #RRGGBB with a human label', () => {
    for (const swatch of ACCENT_PALETTE) {
      expect(swatch.hex).toMatch(/^#[0-9A-F]{6}$/)
      expect(swatch.label.length).toBeGreaterThan(0)
      expect(swatch.id).toMatch(/^[a-z]+$/)
    }
  })
})

describe('DEFAULT_APPEARANCE', () => {
  it('follows the system for both theme and accent', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ theme: 'system', accent: 'system' })
  })
})

describe('isAccentChoice', () => {
  it('accepts system and every palette id, nothing else', () => {
    expect(isAccentChoice('system')).toBe(true)
    for (const swatch of ACCENT_PALETTE) expect(isAccentChoice(swatch.id)).toBe(true)
    expect(isAccentChoice('#CA5010')).toBe(false)
    expect(isAccentChoice('')).toBe(false)
    expect(isAccentChoice(undefined)).toBe(false)
    expect(isAccentChoice('neon')).toBe(false)
  })
})

describe('resolveAccentHex', () => {
  it('maps a palette id to its hex', () => {
    const teal = ACCENT_PALETTE.find((swatch) => swatch.id === 'teal')
    expect(teal).toBeTruthy()
    expect(resolveAccentHex('teal', null)).toBe(teal.hex)
  })

  it('uses the system accent when the choice is system and one is known', () => {
    expect(resolveAccentHex('system', '#0078D4')).toBe('#0078D4')
    expect(resolveAccentHex('system', '#0078d4')).toBe('#0078D4')
  })

  it('falls back to the first palette entry when the system accent is unknown or the choice is invalid', () => {
    expect(resolveAccentHex('system', null)).toBe(ACCENT_PALETTE[0].hex)
    expect(resolveAccentHex('system', 'not-a-color')).toBe(ACCENT_PALETTE[0].hex)
    expect(resolveAccentHex('neon', '#0078D4')).toBe(ACCENT_PALETTE[0].hex)
    expect(resolveAccentHex(undefined, undefined)).toBe(ACCENT_PALETTE[0].hex)
  })
})

describe('onAccentTextColor', () => {
  it('puts white text on dark accents and near-black text on light ones', () => {
    expect(onAccentTextColor('#CA5010')).toBe('#FFFFFF')
    expect(onAccentTextColor('#0078D4')).toBe('#FFFFFF')
    expect(onAccentTextColor('#FCE100')).toBe('#1B1B1B')
    expect(onAccentTextColor('#FFFFFF')).toBe('#1B1B1B')
  })
})

describe('resolveTheme', () => {
  it('passes explicit choices through and follows the system otherwise', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('sepia', true)).toBe('dark')
    expect(resolveTheme(undefined, false)).toBe('light')
  })
})

describe('normalizeAppearance', () => {
  it('fills missing fields with the defaults', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({})).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({ theme: 'dark' })).toEqual({ theme: 'dark', accent: 'system' })
  })

  it('keeps valid values and drops unknown ones', () => {
    expect(normalizeAppearance({ theme: 'light', accent: 'teal' })).toEqual({ theme: 'light', accent: 'teal' })
    expect(normalizeAppearance({ theme: 'sepia', accent: '#CA5010' })).toEqual(DEFAULT_APPEARANCE)
  })
})
