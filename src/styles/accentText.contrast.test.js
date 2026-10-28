// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ACCENT_PALETTE, onAccentTextColor } from '../utils/accent'
import { contrastRatio, hexToRgb, readThemeTokens, resolveColor, tintOver } from '../test-utils/contrast'

// --accent is a fill color the user picks (eight swatches or the live
// Windows accent), so it cannot also be a text color: on dark surfaces a
// saturated blue or purple sits near 3:1, and in light a gold is unreadable.
// --accentText is the text-safe derivative; these assertions evaluate the
// tokens.css expressions for every swatch and a spread of system accents.

const AA = 4.5
const THEMES = readThemeTokens()
const SWATCHES = [...ACCENT_PALETTE.map((swatch) => swatch.hex), '#0078D4']
const SYSTEM_ACCENTS = ['#003E92', '#4CC2FF', '#8E8CD8', '#FCE100', '#000000', '#FFFFFF']

function color(theme, name, accentHex) {
  return resolveColor(`var(--${name})`, THEMES[theme], accentHex)
}

// Surfaces accent text sits on: the page, cards, inputs, an active chip
// (--active over --bg) and an accent badge (12% of the accent over a card).
function accentTextSurfaces(theme, accentHex) {
  const bg = color(theme, 'bg', accentHex)
  const card = color(theme, 'card', accentHex)
  const activeInk = theme === 'dark' ? [255, 255, 255] : [0, 0, 0]
  return {
    bg,
    card,
    surface2:   color(theme, 'surface2', accentHex),
    activeChip: tintOver(activeInk, theme === 'dark' ? 0.09 : 0.07, bg),
    badgeOnCard: tintOver(hexToRgb(accentHex), 0.12, card),
    badgeOnBg:   tintOver(hexToRgb(accentHex), 0.12, bg),
  }
}

describe.each(['dark', 'light'])('%s theme', (theme) => {
  it.each([...SWATCHES, ...SYSTEM_ACCENTS])('--accentText clears AA for accent %s', (accentHex) => {
    const text = color(theme, 'accentText', accentHex)
    for (const [surface, rgb] of Object.entries(accentTextSurfaces(theme, accentHex))) {
      expect(contrastRatio(text, rgb), `${theme} ${accentHex} on ${surface}`).toBeGreaterThanOrEqual(AA)
    }
  })

  it.each(SWATCHES)('the label on an accent fill clears AA for accent %s', (accentHex) => {
    const label = hexToRgb(onAccentTextColor(accentHex))
    for (const fill of ['accent', 'btnAccent']) {
      const ratio = contrastRatio(label, color(theme, fill, accentHex))
      expect(ratio, `${theme} --onAccent on --${fill}`).toBeGreaterThanOrEqual(AA)
    }
  })

  // Status badges, log levels, save messages and the danger confirm paint a
  // status color over a 12-18% tint of itself.
  it.each(['ok', 'warn', 'err'])('--%s clears AA on its own tint', (status) => {
    const ink = color(theme, status)
    for (const base of ['bg', 'card']) {
      for (const alpha of [0, 0.12, 0.14, 0.18]) {
        const ratio = contrastRatio(ink, tintOver(ink, alpha, color(theme, base)))
        expect(ratio, `${theme} --${status} on ${alpha * 100}% tint over --${base}`).toBeGreaterThanOrEqual(AA)
      }
    }
  })
})

describe('foreground never paints the raw accent fill', () => {
  const FOREGROUND_ACCENT = /(?:^|[\s;{])(?:color|text-decoration-color|caret-color)\s*:\s*var\(--(?:accent|accentHi|accent-dark|info)\)/gm

  function cssFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return cssFiles(path)
      return entry.name.endsWith('.css') ? [path] : []
    })
  }

  it('uses --accentText for accent-colored text and glyphs', () => {
    const offenders = cssFiles(join(process.cwd(), 'src')).flatMap((path) => {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      return (css.match(FOREGROUND_ACCENT) ?? []).map((match) => `${relative(process.cwd(), path)}: ${match.trim()}`)
    })
    expect(offenders).toEqual([])
  })
})
