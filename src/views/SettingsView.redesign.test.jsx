import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import SettingsView from './SettingsView'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — Settings on the redesign, after ref/settings.png:
// a title and a two-column grid of cards, no accordion. Every control the
// app has today keeps working inside its card; the prototype's rows that
// have no backing setting are not invented.
//
// DOM contract:
//   - <h1>Settings</h1>
//   - cards are <section aria-label="<card title>"> with a level-2 heading
//     of the same text, in this order: "Startup & background",
//     "Appearance", "Play", "Snapshot", "Thumbnails", "Remote browser",
//     "Updates", "Security"
//   - "Startup & background" holds the watcher start/stop control and the
//     tray sentence "Closing the window keeps WinRaid running in the tray"
//   - "Thumbnails" holds the video thumbnail frame control and the cache
//     line with its Clear button
//   - "Remote browser" holds the directory cache, folder-mutation, folder
//     order and sort persistence controls
//   - "Updates" holds the version line and the update check
//   - "Security" states that credentials are protected with DPAPI
//   - there is no "Advanced settings" disclosure any more

const CARD_ORDER = ['Startup & background', 'Appearance', 'Play', 'Snapshot', 'Thumbnails', 'Remote browser', 'Updates', 'Security']

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'playDefaults') return Promise.resolve({ recursive: true, shuffle: false })
        if (key === 'appearance') return Promise.resolve({ theme: 'dark', accent: 'orange' })
        return Promise.resolve({})
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
  window.winraid.system = { accentColor: vi.fn().mockResolvedValue(null), onAccentColorChanged: vi.fn().mockReturnValue(() => {}) }
})

afterEach(() => { delete window.winraid; localStorage.clear() })

async function mount() {
  render(<SettingsView />)
  await act(async () => {})
}

function card(title) {
  return screen.getByRole('region', { name: title })
}

describe('SettingsView redesign', () => {
  it('has the title and the cards in prototype order, each with its own heading', async () => {
    await mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    const order = screen.getAllByRole('region').map((section) => section.getAttribute('aria-label'))
    expect(order).toEqual(CARD_ORDER)
    for (const title of CARD_ORDER) {
      expect(within(card(title)).getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Advanced settings/i })).toBeNull()
  })

  it('keeps the watcher control and the tray note under Startup & background', async () => {
    await mount()
    const startup = card('Startup & background')
    expect(within(startup).getByRole('button', { name: /start|stop/i })).toBeInTheDocument()
    expect(startup.textContent).toContain('Closing the window keeps WinRaid running in the tray')
  })

  it('keeps the thumbnail frame control and the cache line under Thumbnails', async () => {
    await mount()
    const thumbnails = card('Thumbnails')
    expect(within(thumbnails).getByRole('radiogroup')).toBeInTheDocument()
    expect(within(thumbnails).getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('keeps the browser settings under Remote browser', async () => {
    await mount()
    const browser = card('Remote browser')
    expect(within(browser).getAllByRole('radiogroup').length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the version and update check under Updates, and the DPAPI note under Security', async () => {
    await mount()
    expect(card('Updates').textContent).toMatch(/1\.1\.0/)
    expect(within(card('Updates')).getByRole('button', { name: /check/i })).toBeInTheDocument()
    expect(card('Security').textContent).toMatch(/DPAPI/)
  })
})
