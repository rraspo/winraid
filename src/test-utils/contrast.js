import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// WCAG contrast over the real tokens.css values, with just enough of a CSS
// color evaluator to resolve the token expressions the stylesheet uses
// (hex literals, var(--accent), color-mix in oklab, and oklch relative
// colors clamped with min()/max()). Compositing a translucent tint over a
// surface happens in sRGB, as the browser paints it.

export function hexToRgb(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
}

function toLinear(channel) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function toGamma(linear) {
  const value = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
}

export function relativeLuminance(rgb) {
  const [red, green, blue] = rgb.map(toLinear)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

// `color-mix(in <space>, X p%, transparent)` painted over `base`.
export function tintOver(rgb, alpha, base) {
  return rgb.map((channel, index) => channel * alpha + base[index] * (1 - alpha))
}

export function rgbToOklab(rgb) {
  const [red, green, blue] = rgb.map(toLinear)
  const long   = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const short  = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ]
}

// Out-of-gamut results are clipped per channel, as Chromium paints them.
export function oklabToRgb([lightness, axisA, axisB]) {
  const long   = (lightness + 0.3963377774 * axisA + 0.2158037573 * axisB) ** 3
  const medium = (lightness - 0.1055613458 * axisA - 0.0638541728 * axisB) ** 3
  const short  = (lightness - 0.0894841775 * axisA - 1.291485548 * axisB) ** 3
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((linear) => toGamma(Math.min(1, Math.max(0, linear))))
}

const NAMED = { white: '#FFFFFF', black: '#000000' }

function clampChannel(expression, channelValue) {
  const match = expression.match(/^(min|max)\(\s*[lc]\s*,\s*([\d.]+)\s*\)$/)
  if (expression === 'l' || expression === 'c' || expression === 'h') return channelValue
  if (!match) throw new Error(`unsupported relative channel: ${expression}`)
  const limit = Number(match[2])
  return match[1] === 'min' ? Math.min(channelValue, limit) : Math.max(channelValue, limit)
}

// Resolves a token value to rgb, given the theme's other tokens and the
// accent hex that App writes to --accent.
export function resolveColor(value, tokens, accentHex) {
  const expression = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(expression)) return hexToRgb(expression)
  if (NAMED[expression]) return hexToRgb(NAMED[expression])
  const variable = expression.match(/^var\(--([\w-]+)\)$/)
  if (variable) {
    if (variable[1] === 'accent') return hexToRgb(accentHex)
    if (!(variable[1] in tokens)) throw new Error(`unknown token --${variable[1]}`)
    return resolveColor(tokens[variable[1]], tokens, accentHex)
  }
  const mix = expression.match(/^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%,\s*(.+?)\)$/)
  if (mix) {
    const weight = Number(mix[2]) / 100
    const first  = rgbToOklab(resolveColor(mix[1], tokens, accentHex))
    const second = rgbToOklab(resolveColor(mix[3], tokens, accentHex))
    return oklabToRgb(first.map((component, index) => component * weight + second[index] * (1 - weight)))
  }
  const relative = expression.match(/^oklch\(from\s+(var\(--[\w-]+\))\s+((?:min|max)\([^)]*\)|l)\s+((?:min|max)\([^)]*\)|c)\s+h\)$/)
  if (relative) {
    const [lightness, axisA, axisB] = rgbToOklab(resolveColor(relative[1], tokens, accentHex))
    const chroma = Math.hypot(axisA, axisB)
    const nextChroma = clampChannel(relative[3], chroma)
    const scale = chroma === 0 ? 0 : nextChroma / chroma
    return oklabToRgb([clampChannel(relative[2], lightness), axisA * scale, axisB * scale])
  }
  throw new Error(`unsupported color expression: ${expression}`)
}

function readRules(cssPath) {
  const css = readFileSync(resolve(process.cwd(), cssPath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = {}
    for (const declaration of match[2].split(';')) {
      const separator = declaration.indexOf(':')
      if (separator === -1) continue
      declarations[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim()
    }
    rules.push({ selector: match[1].trim(), declarations })
  }
  return rules
}

// Custom properties per theme, as the cascade gives them: dark is the base,
// light overrides only what changes.
export function readThemeTokens(cssPath = 'src/styles/tokens.css') {
  const pick = (theme) => {
    const tokens = {}
    for (const rule of readRules(cssPath)) {
      if (!rule.selector.includes(`[data-theme="${theme}"]`)) continue
      for (const [name, value] of Object.entries(rule.declarations)) {
        if (name.startsWith('--')) tokens[name.slice(2)] = value
      }
    }
    return tokens
  }
  const dark = pick('dark')
  return { dark, light: { ...dark, ...pick('light') } }
}

// Declarations of the rule whose selector is exactly `selector`.
export function readRule(cssPath, selector) {
  return readRules(cssPath).find((rule) => rule.selector === selector)?.declarations ?? null
}
