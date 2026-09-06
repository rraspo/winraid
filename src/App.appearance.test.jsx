import { render, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from './App'
import { ACCENT_PALETTE } from './utils/accent'

// Contract under test — App owns the two appearance side effects:
//   - document.documentElement[data-theme] follows appearance.theme, with
//     'system' resolved through prefers-color-scheme
//   - document.documentElement.style sets `--accent` (the resolved hex) and
//     `--onAccent` (the readable text color on it); every other accent
//     token lives in CSS and derives from `--accent`
//   - a 'system' accent tracks the Windows accent live through
//     system.onAccentColorChanged
//   - the pre-redesign localStorage key 'winraid-theme' migrates once into
//     appearance.theme and is removed

vi.mock('./components/Sidebar',      () => ({ default: () => <div /> }))
vi.mock('./components/Header',       () => ({ default: () => <div /> }))
vi.mock('./components/StatusBar',    () => ({ default: () => <div /> }))
vi.mock('./components/TabBar',       () => ({ default: () => <div /> }))
vi.mock('./components/EditorView',   () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))
vi.mock('./views/BrowseView',        () => ({ default: () => <div /> }))
vi.mock('./views/ConnectionView',    () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView',     () => ({ default: () => <div /> }))
vi.mock('./views/QueueView',         () => ({ default: () => <div /> }))
vi.mock('./views/BackupView',        () => ({ default: () => <div /> }))
vi.mock('./views/SizeView',          () => ({ default: () => <div /> }))
vi.mock('./views/SettingsView',      () => ({ default: () => <div /> }))
vi.mock('./views/LogView',           () => ({ default: () => <div /> }))

const noopSubscribe = () => () => {}

let accentChangeListener = null
let savedMatchMedia

function setup({ appearance = {}, systemAccent = '#0078D4', prefersDark = true } = {}) {
  accentChangeListener = null
  window.winraid = {
    config: {
      get: vi.fn(async (key) => {
        if (key === 'appearance') return appearance
        return { connections: [], favoritesByConnection: {} }
      }),
      set: vi.fn(async () => {}),
    },
    system: {
      accentColor:          vi.fn(async () => systemAccent),
      onAccentColorChanged: vi.fn((listener) => { accentChangeListener = listener; return () => {} }),
    },
    watcher:  { list: vi.fn(async () => ({})), onStatus: noopSubscribe, pauseAll: vi.fn(), resumeAll: vi.fn() },
    queue:    { list: vi.fn(async () => []), onProgress: noopSubscribe, onUpdated: noopSubscribe, pause: vi.fn(), resume: vi.fn() },
    backup:   { onProgress: noopSubscribe },
    activity: { reveal: vi.fn() },
  }
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('dark') ? prefersDark : !prefersDark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}

function rootStyle(name) {
  return document.documentElement.style.getPropertyValue(name).trim()
}

async function mount() {
  render(<App />)
  await act(async () => {})
}

beforeEach(() => {
  savedMatchMedia = window.matchMedia
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('--accent')
  document.documentElement.style.removeProperty('--onAccent')
})

afterEach(() => {
  window.matchMedia = savedMatchMedia
  delete window.winraid
})

describe('App appearance', () => {
  it('applies a stored explicit theme and palette accent', async () => {
    setup({ appearance: { theme: 'light', accent: 'teal' }, prefersDark: true })
    await mount()
    const teal = ACCENT_PALETTE.find((swatch) => swatch.id === 'teal')
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    await waitFor(() => expect(rootStyle('--accent')).toBe(teal.hex))
    expect(rootStyle('--onAccent')).toBe('#FFFFFF')
  })

  it('resolves a system theme through prefers-color-scheme', async () => {
    setup({ appearance: { theme: 'system', accent: 'orange' }, prefersDark: false })
    await mount()
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    expect(rootStyle('--accent')).toBe('#CA5010')
  })

  it('applies the Windows accent for a system accent and follows it live', async () => {
    setup({ appearance: { theme: 'dark', accent: 'system' }, systemAccent: '#0078D4' })
    await mount()
    await waitFor(() => expect(rootStyle('--accent')).toBe('#0078D4'))
    expect(accentChangeListener).toBeTypeOf('function')
    await act(async () => { accentChangeListener('#10893E') })
    await waitFor(() => expect(rootStyle('--accent')).toBe('#10893E'))
  })

  it('falls back to the first palette swatch when the platform has no system accent', async () => {
    setup({ appearance: { theme: 'dark', accent: 'system' }, systemAccent: null })
    await mount()
    await waitFor(() => expect(rootStyle('--accent')).toBe(ACCENT_PALETTE[0].hex))
  })

  it('migrates the old localStorage theme into appearance once and removes the key', async () => {
    localStorage.setItem('winraid-theme', 'light')
    setup({ appearance: {}, prefersDark: true })
    await mount()
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    await waitFor(() => expect(window.winraid.config.set).toHaveBeenCalledWith('appearance', expect.objectContaining({ theme: 'light' })))
    expect(localStorage.getItem('winraid-theme')).toBeNull()
  })

  it('does not touch the stored appearance when there is nothing to migrate', async () => {
    setup({ appearance: { theme: 'dark', accent: 'orange' } })
    await mount()
    await waitFor(() => expect(rootStyle('--accent')).toBe('#CA5010'))
    expect(window.winraid.config.set).not.toHaveBeenCalledWith('appearance', expect.anything())
  })
})
