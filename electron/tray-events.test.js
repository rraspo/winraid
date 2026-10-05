// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { wireTrayEvents } from './tray-events.js'

// Contract under test — every gesture the tray icon accepts leads somewhere.
//
// The flyout replaced the tray's context menu, and the replacement was bound
// to left click only. Right click is the gesture Windows users reach for on a
// tray icon, and it had nothing behind it: the menu it used to open no longer
// existed and nothing took its place, so it silently did nothing.
//
// Both clicks open the flyout, because the flyout is the menu now. Double
// click still raises the main window.

function fakeTray() {
  const handlers = new Map()
  return {
    on: (event, handler) => { handlers.set(event, handler) },
    fire: (event) => {
      const handler = handlers.get(event)
      if (!handler) throw new Error(`nothing is bound to "${event}"`)
      handler()
    },
    bound: () => [...handlers.keys()],
  }
}

describe('tray gestures', () => {
  it('opens the flyout on a right click', () => {
    const tray = fakeTray()
    const showFlyout = vi.fn()
    wireTrayEvents(tray, { showFlyout, showMain: vi.fn() })

    tray.fire('right-click')
    expect(showFlyout).toHaveBeenCalledTimes(1)
  })

  it('opens the flyout on a left click', () => {
    const tray = fakeTray()
    const showFlyout = vi.fn()
    wireTrayEvents(tray, { showFlyout, showMain: vi.fn() })

    tray.fire('click')
    expect(showFlyout).toHaveBeenCalledTimes(1)
  })

  it('raises the main window on a double click', () => {
    const tray = fakeTray()
    const showMain = vi.fn()
    wireTrayEvents(tray, { showFlyout: vi.fn(), showMain })

    tray.fire('double-click')
    expect(showMain).toHaveBeenCalledTimes(1)
  })

  it('leaves no gesture unbound', () => {
    const tray = fakeTray()
    wireTrayEvents(tray, { showFlyout: vi.fn(), showMain: vi.fn() })
    expect(tray.bound().sort()).toEqual(['click', 'double-click', 'right-click'])
  })
})
