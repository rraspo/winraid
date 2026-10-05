// Tray gesture wiring, kept out of main.js so it can be tested without
// loading the composition root.
//
// The flyout replaced the tray's context menu. Windows users reach for the
// right click on a tray icon, so it opens the flyout too: the flyout is the
// menu now, and binding only the left click left the gesture people actually
// use doing nothing at all.
export function wireTrayEvents(tray, { showFlyout, showMain }) {
  tray.on('click',        () => { showFlyout() })
  tray.on('right-click',  () => { showFlyout() })
  tray.on('double-click', () => { showMain() })
}
