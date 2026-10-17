// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ACCENT_PALETTE } from '../utils/accent'
import { contrastRatio, hexToRgb, readRule, readThemeTokens, resolveColor, tintOver } from '../test-utils/contrast'

// WCAG AA for body text is 4.5:1. These assertions run on the literal
// tokens.css values, so a retune that drops a pairing below AA fails here
// before it reaches a screen. jsdom/happy-dom computes no styles from these
// files, so the pairings are evaluated directly rather than read from a DOM.

const AA = 4.5
const THEMES = readThemeTokens()
// Every Settings swatch plus Windows system accents the palette lacks: the
// default blue, a dark navy, a light sky and a pale lavender.
const ACCENTS = [...ACCENT_PALETTE.map((swatch) => swatch.hex), '#003E92', '#4CC2FF', '#8E8CD8']
const DEFAULT_ACCENT = '#0078D4'

function color(theme, name, accentHex = DEFAULT_ACCENT) {
  return resolveColor(`var(--${name})`, THEMES[theme], accentHex)
}

function surfaces(theme) {
  const card = color(theme, 'card')
  const hoverInk = theme === 'dark' ? [255, 255, 255] : [0, 0, 0]
  return {
    bg:        color(theme, 'bg'),
    card,
    surface2:  color(theme, 'surface2'),
    hoverCard: tintOver(hoverInk, theme === 'dark' ? 0.05 : 0.04, card),
  }
}

describe.each(['dark', 'light'])('%s theme muted text', (theme) => {
  it.each(Object.keys(surfaces(theme)))('--text3 clears AA on %s', (surface) => {
    const ratio = contrastRatio(color(theme, 'text3'), surfaces(theme)[surface])
    expect(ratio, `${theme} --text3 on ${surface}`).toBeGreaterThanOrEqual(AA)
  })

  it('keeps --text3 a visible step below --text2', () => {
    const bg = color(theme, 'bg')
    const text2 = contrastRatio(color(theme, 'text2'), bg)
    const text3 = contrastRatio(color(theme, 'text3'), bg)
    expect(text2 / text3).toBeGreaterThanOrEqual(1.3)
  })

  // Browse rows and grid cards paint an accent tint when selected (10-15%),
  // last visited (25%) or under the type-to-jump cursor (30%). Muted cells in
  // those rows step up one level (--text3 -> --text2), and to full --text on
  // the 30% cursor tint, which no muted gray clears for every accent.
  it.each(ACCENTS)('row text clears AA on every accent tint for %s', (accentHex) => {
    const accent = hexToRgb(accentHex)
    for (const base of [color(theme, 'bg'), color(theme, 'card')]) {
      for (const alpha of [0.08, 0.1, 0.15, 0.25]) {
        const ratio = contrastRatio(color(theme, 'text2', accentHex), tintOver(accent, alpha, base))
        expect(ratio, `${theme} --text2 on ${alpha * 100}% ${accentHex}`).toBeGreaterThanOrEqual(AA)
      }
      const cursor = contrastRatio(color(theme, 'text', accentHex), tintOver(accent, 0.3, base))
      expect(cursor, `${theme} --text on 30% ${accentHex}`).toBeGreaterThanOrEqual(AA)
    }
  })
})

describe('accent-tinted rows lift their muted text', () => {
  const LIFTED  = { '--text3': 'var(--text2)' }
  const TO_FULL = { '--text2': 'var(--text)', '--text3': 'var(--text)' }

  it.each([
    ['src/views/BrowseList.module.css', '.rowSelected', LIFTED],
    ['src/views/BrowseList.module.css', '.lastVisited', LIFTED],
    ['src/views/BrowseList.module.css', '.cursor', TO_FULL],
    ['src/components/browse/GridCard.module.css', '.gridCardSelected', LIFTED],
    ['src/components/browse/GridCard.module.css', '.lastVisited', LIFTED],
    ['src/components/browse/GridCard.module.css', '.cursor', TO_FULL],
    ['src/views/ConnectionView.module.css', '.protocolCardActive', LIFTED],
  ])('%s %s', (cssPath, selector, expected) => {
    expect(readRule(cssPath, selector)).toMatchObject(expected)
  })
})
