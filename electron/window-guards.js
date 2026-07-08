// Navigation guards for the main BrowserWindow's webContents. Renderer or
// NAS-sourced content (a crafted filename rendered into a link, the
// CSP-whitelisted CDN content) must never be able to spawn new windows or
// navigate the app away from its own origin. Extracted as plain functions so
// the deny/prevent behaviour is unit-testable without spinning up Electron.

/**
 * Builds the `setWindowOpenHandler` callback: every `window.open()` /
 * target=_blank request is denied outright. Legitimate external links are
 * routed through `shell.openExternal` explicitly by the caller instead of
 * letting Chromium open a new BrowserWindow.
 *
 * @returns {(details: { url: string }) => { action: 'deny' }}
 */
export function createWindowOpenHandler() {
  return () => ({ action: 'deny' })
}

/**
 * Builds a `will-navigate` handler that blocks any top-level navigation away
 * from the app's own page (e.g. a compromised renderer or injected content
 * trying to redirect the window to an external page or a different local
 * file). Only a hash change on the exact same URL — origin AND pathname — is
 * allowed, which covers the app's own hash-routed views (e.g. `#whatsnew`).
 *
 * `origin` alone is not enough: every `file:` URL reports the same opaque
 * `"null"` origin regardless of path, so without the pathname check a
 * crafted `file://` link (e.g. built from a NAS filename) could navigate the
 * window to read an arbitrary local file.
 *
 * @param {string} appUrl - the exact URL the app is allowed to navigate within
 *   (e.g. `http://localhost:5173/` in dev, the packaged `index.html` file URL
 *   in production)
 * @returns {(event: { preventDefault: () => void }, url: string) => void}
 */
export function createWillNavigateHandler(appUrl) {
  const allowed = new URL(appUrl)
  return (event, url) => {
    let target
    try {
      target = new URL(url)
    } catch {
      event.preventDefault()
      return
    }
    const staysOnApp = target.origin === allowed.origin && target.pathname === allowed.pathname
    if (!staysOnApp) {
      event.preventDefault()
    }
  }
}
