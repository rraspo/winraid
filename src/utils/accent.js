// Accent system behind Settings > Appearance.
//
// The app never hardcodes an accent color: the user picks either "System"
// (follow the Windows accent color) or one of the fixed palette swatches
// below, and every accent-derived color in CSS is computed from the single
// `--accent` custom property this module resolves. Pure functions only —
// callers own reading the platform accent and writing it to the DOM.

export const ACCENT_PALETTE = [
  { id: 'orange',  label: 'Orange',  hex: '#CA5010' },
  { id: 'blue',    label: 'Blue',    hex: '#0078D4' },
  { id: 'teal',    label: 'Teal',    hex: '#038387' },
  { id: 'green',   label: 'Green',   hex: '#107C10' },
  { id: 'purple',  label: 'Purple',  hex: '#744DA9' },
  { id: 'magenta', label: 'Magenta', hex: '#C239B3' },
  { id: 'red',     label: 'Red',     hex: '#E81123' },
  { id: 'gold',    label: 'Gold',    hex: '#FFB900' },
]

export const DEFAULT_APPEARANCE = { theme: 'system', accent: 'system' }

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function findSwatch(id) {
  return ACCENT_PALETTE.find((swatch) => swatch.id === id) ?? null
}

export function isAccentChoice(value) {
  return value === 'system' || findSwatch(value) !== null
}

export function resolveAccentHex(choice, systemHex) {
  if (choice === 'system') {
    if (typeof systemHex === 'string' && HEX_COLOR_PATTERN.test(systemHex)) {
      return systemHex.toUpperCase()
    }
    return ACCENT_PALETTE[0].hex
  }
  const swatch = findSwatch(choice)
  return swatch ? swatch.hex : ACCENT_PALETTE[0].hex
}

// Relative luminance (WCAG) of a #RRGGBB hex color, used to decide whether
// text drawn on top of it should be white or near-black.
function relativeLuminance(hex) {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((channel) => {
    const normalized = parseInt(channel, 16) / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function onAccentTextColor(hex) {
  return relativeLuminance(hex) > 0.5 ? '#1B1B1B' : '#FFFFFF'
}

export function resolveTheme(choice, systemPrefersDark) {
  if (choice === 'dark' || choice === 'light') return choice
  return systemPrefersDark ? 'dark' : 'light'
}

export function normalizeAppearance(raw) {
  const theme  = raw?.theme === 'dark' || raw?.theme === 'light' || raw?.theme === 'system'
    ? raw.theme
    : DEFAULT_APPEARANCE.theme
  const accent = isAccentChoice(raw?.accent) ? raw.accent : DEFAULT_APPEARANCE.accent
  return { theme, accent }
}
