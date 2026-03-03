/**
 * Structured log bridge.
 *
 * worker.js / watcher.js import { log } from './logger.js'
 * main.js calls initLogger(sendFn) once the window is ready.
 *
 * Each session's logs are appended to a dated file:
 *   %APPDATA%\WinRaid\logs\YYYY-MM-DD.log
 *
 * The file stays open for the lifetime of the process so writes are cheap.
 */

import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, createWriteStream } from 'fs'

let _send    = null
let _stream  = null
let _logPath = null

/** Called once from main.js after the BrowserWindow is created. */
export function initLogger(sendFn) {
  _send = sendFn

  const dir  = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })

  const date = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
  _logPath   = join(dir, `${date}.log`)
  _stream    = createWriteStream(_logPath, { flags: 'a', encoding: 'utf8' })
}

/** Absolute path to today's log file (null until initLogger is called). */
export function getLogPath() {
  return _logPath
}

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 */
export function log(level, message) {
  const ts      = Date.now()
  const time    = new Date(ts).toTimeString().slice(0, 8)  // HH:MM:SS
  const entry   = { level, message, ts }
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log

  consoleFn(`[winraid/${level}] ${message}`)
  _stream?.write(`[${time}] [${level.toUpperCase().padEnd(5)}] ${message}\n`)
  _send?.('log:entry', entry)
}
