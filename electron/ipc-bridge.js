import { Notification } from 'electron'

// ---------------------------------------------------------------------------
// IPC bridge — the one place business logic reaches the renderer / OS.
//
// Extracted from main.js (WR-28) to break the worker.js -> main.js import
// cycle. Business modules (worker, scan engines, queue callbacks) import from
// here instead of from the composition root, so they load under test without
// pulling the entire main.js module. main.js owns the BrowserWindow and hands
// it to this bridge once, at window creation, via init().
// ---------------------------------------------------------------------------

let mainWindow = null

/**
 * Registers the renderer target. Called once by main.js after the main
 * BrowserWindow is created.
 *
 * @param {import('electron').BrowserWindow | null} win
 */
export function init(win) {
  mainWindow = win
}

/**
 * Sends an IPC message to the renderer, guarding against a torn-down window.
 * No-op before init() or after the webContents is destroyed.
 */
export function sendToRenderer(channel, payload) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * Shows a desktop notification when the platform supports it.
 */
export function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show()
  }
}
