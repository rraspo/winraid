import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import TitleBar from './TitleBar'

// Contract under test — the window is frameless; this 40px bar is the
// window's own chrome: the app icon, the name, a drag region, and the
// three window controls wired to the main process.
//
// DOM contract:
//   - <header> containing the text "WinRaid"
//   - buttons named "Minimize", "Maximize" (renamed "Restore" while the
//     window is maximized) and "Close"
//   - Minimize calls window.winraid.window.minimize()
//   - Maximize/Restore calls window.winraid.window.toggleMaximize()
//   - Close calls window.winraid.window.close() (the main process decides
//     whether that hides to the tray or quits)
//   - on mount it reads window.winraid.window.isMaximized() and subscribes
//     to window.winraid.window.onMaximizedChanged(listener), unsubscribing
//     on unmount

let maximizedListener = null
let unsubscribe

beforeEach(() => {
  maximizedListener = null
  unsubscribe = vi.fn()
  window.winraid = {
    window: {
      minimize:           vi.fn().mockResolvedValue(undefined),
      toggleMaximize:     vi.fn().mockResolvedValue(undefined),
      close:              vi.fn().mockResolvedValue(undefined),
      isMaximized:        vi.fn().mockResolvedValue(false),
      onMaximizedChanged: vi.fn((listener) => { maximizedListener = listener; return unsubscribe }),
    },
  }
})

afterEach(() => { delete window.winraid })

async function mount() {
  const utils = render(<TitleBar />)
  await act(async () => {})
  return utils
}

describe('TitleBar', () => {
  it('renders the app name inside a banner with the three window controls', async () => {
    await mount()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByText('WinRaid')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('drives the window through the bridge', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(window.winraid.window.minimize).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    expect(window.winraid.window.toggleMaximize).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(window.winraid.window.close).toHaveBeenCalledTimes(1)
  })

  it('starts as Restore when the window is already maximized', async () => {
    window.winraid.window.isMaximized.mockResolvedValue(true)
    await mount()
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull()
  })

  it('follows maximize changes from the main process and unsubscribes on unmount', async () => {
    const { unmount } = await mount()
    expect(maximizedListener).toBeTypeOf('function')
    await act(async () => { maximizedListener(true) })
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    await act(async () => { maximizedListener(false) })
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
