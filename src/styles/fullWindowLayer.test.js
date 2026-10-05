import { describe, it, expect } from 'vitest'
import { findFixedFullWindowInsetZero } from '../test-utils/fixedLayerInsets'

// Every screen or dialog that covers the whole window is a `position: fixed`
// layer — Quick Look, the Play viewer's covering/fullscreen modes, the
// connection and path-picker dialogs. On Windows, `inset: 0` on one of these
// paints over the frameless window's own title bar: Electron hands that
// strip to the OS as drag/caption, so a layer drawn over it steals clicks
// from Minimize, Maximize and Close (see hit-audit.mjs). Every one of them
// must start at `var(--titlebar-height)` instead.
describe('full-window fixed layers stay clear of the title bar', () => {
  for (const modulePath of [
    'src/components/QuickLookOverlay.module.css',
    'src/components/PlayOverlay.module.css',
    'src/components/modals/modals.module.css',
    'src/components/ConnectionModal.module.css',
    'src/components/RemotePathBrowser.module.css',
    'src/views/ConnectionView.module.css',
    // Not owned by this change, but the guard should hold for the whole
    // tree — BrowseView's own full-window-looking overlays are all
    // `position: absolute` inside an already title-bar-clear container, so
    // this passes without any change there.
    'src/views/BrowseView.module.css',
  ]) {
    it(`${modulePath} has no bare "inset: 0" on a position: fixed rule`, () => {
      const offenders = findFixedFullWindowInsetZero(modulePath)
      expect(offenders, `full-window fixed layer(s) painted over the title bar in ${modulePath}: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
