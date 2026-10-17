// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Control outlines must hold 3:1 against every surface a control can sit on
// (WCAG 1.4.11). Values are read from tokens.css so a retune cannot silently
// regress the ratio.
const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')

function block(selectorStart) {
  const start = css.indexOf(selectorStart)
  return css.slice(start, css.indexOf('\n}', start))
}

function token(blockText, name) {
  const match = blockText.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))
  return match ? match[1] : null
}

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const themes = {
  dark: block(':root,\n[data-theme="dark"]'),
  light: block('[data-theme="light"]'),
}

describe.each(Object.keys(themes))('--outline in the %s theme', (theme) => {
  const darkBlock = themes.dark
  const themeBlock = themes[theme]
  // Light only overrides what changes, so fall back to the dark block.
  const resolveToken = (name) => token(themeBlock, name) ?? token(darkBlock, name)

  it('is defined', () => {
    expect(resolveToken('outline')).not.toBeNull()
  })

  it.each(['bg', 'card', 'surface2'])('reaches 3:1 against --%s', (surface) => {
    expect(contrast(resolveToken('outline'), resolveToken(surface))).toBeGreaterThanOrEqual(3)
  })
})
