// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { NotificationMock, notificationShow } = vi.hoisted(() => {
  const notificationShow = vi.fn()
  const NotificationMock = vi.fn(function () {
    return { show: notificationShow }
  })
  NotificationMock.isSupported = vi.fn(() => true)
  return { NotificationMock, notificationShow }
})

vi.mock('electron', () => ({ Notification: NotificationMock }))

import { init, sendToRenderer, notify } from './ipc-bridge.js'

describe('ipc-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    NotificationMock.isSupported.mockReturnValue(true)
  })

  it('sends to the initialized window webContents', () => {
    const send = vi.fn()
    init({ webContents: { send, isDestroyed: () => false } })
    sendToRenderer('watcher:status', { ok: true })
    expect(send).toHaveBeenCalledWith('watcher:status', { ok: true })
  })

  it('is a no-op when the webContents is destroyed', () => {
    const send = vi.fn()
    init({ webContents: { send, isDestroyed: () => true } })
    sendToRenderer('watcher:status', {})
    expect(send).not.toHaveBeenCalled()
  })

  it('is a no-op before init (no window registered)', () => {
    init(null)
    expect(() => sendToRenderer('watcher:status', {})).not.toThrow()
  })

  it('shows a desktop notification when supported', () => {
    notify('Transfer complete', 'movie.mkv')
    expect(NotificationMock).toHaveBeenCalledWith({
      title: 'Transfer complete',
      body: 'movie.mkv',
      silent: false,
    })
    expect(notificationShow).toHaveBeenCalledTimes(1)
  })

  it('does not notify when notifications are unsupported', () => {
    NotificationMock.isSupported.mockReturnValue(false)
    notify('Transfer complete', 'movie.mkv')
    expect(notificationShow).not.toHaveBeenCalled()
  })
})
