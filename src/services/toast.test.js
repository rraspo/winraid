import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as toast from './toast'

beforeEach(() => { vi.useFakeTimers(); toast.clearAll() })
afterEach(() => { toast.clearAll(); vi.useRealTimers() })

describe('toast store', () => {
  it('show adds a toast and returns its id', () => {
    const id = toast.show({ msg: 'Hello' })
    const list = toast.getSnapshot()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, msg: 'Hello', type: 'info' })
  })

  it('auto-dismisses a transient toast after its duration', () => {
    toast.show({ msg: 'bye', duration: 4000 })
    expect(toast.getSnapshot()).toHaveLength(1)
    vi.advanceTimersByTime(4000)
    // Lingers in an exiting phase for the out animation, then is removed.
    expect(toast.getSnapshot()[0].exiting).toBe(true)
    vi.advanceTimersByTime(200)
    expect(toast.getSnapshot()).toHaveLength(0)
  })

  it('dismisses transient toasts in arrival order (FIFO)', () => {
    toast.show({ msg: 'first', duration: 4000 })
    vi.advanceTimersByTime(1000)
    toast.show({ msg: 'second', duration: 4000 })
    // Advance to the first toast's expiry (3000 more = 4000 total) plus its exit.
    vi.advanceTimersByTime(3000 + 200)
    const list = toast.getSnapshot()
    expect(list).toHaveLength(1)
    expect(list[0].msg).toBe('second')
  })

  it('does not auto-dismiss a sticky toast', () => {
    toast.show({ msg: 'stay', sticky: true })
    vi.advanceTimersByTime(60000)
    expect(toast.getSnapshot()).toHaveLength(1)
  })

  it('replaces a toast with the same id instead of duplicating', () => {
    toast.show({ id: 'job', msg: 'Fetching…', sticky: true })
    toast.show({ id: 'job', msg: 'Done', sticky: true })
    const list = toast.getSnapshot()
    expect(list).toHaveLength(1)
    expect(list[0].msg).toBe('Done')
  })

  it('dismiss starts the exit phase, then removes the toast', () => {
    const id = toast.show({ msg: 'x', duration: 4000 })
    toast.dismiss(id)
    expect(toast.getSnapshot()[0].exiting).toBe(true)
    vi.advanceTimersByTime(200)
    expect(toast.getSnapshot()).toHaveLength(0)
    vi.advanceTimersByTime(4000) // original auto-dismiss cancelled; no resurrection
    expect(toast.getSnapshot()).toHaveLength(0)
  })

  it('pause stops the dismiss timer; resume restarts it', () => {
    const id = toast.show({ msg: 'hover', duration: 4000 })
    toast.pause(id)
    vi.advanceTimersByTime(10000)
    expect(toast.getSnapshot()).toHaveLength(1)
    toast.resume(id)
    vi.advanceTimersByTime(4000)         // auto-dismiss fires -> exiting
    expect(toast.getSnapshot()[0].exiting).toBe(true)
    vi.advanceTimersByTime(200)          // exit grace elapses -> removed
    expect(toast.getSnapshot()).toHaveLength(0)
  })

  it('getSnapshot returns a stable reference between mutations', () => {
    toast.show({ msg: 'a' })
    const a = toast.getSnapshot()
    const b = toast.getSnapshot()
    expect(a).toBe(b)
    toast.show({ msg: 'b' })
    expect(toast.getSnapshot()).not.toBe(a)
  })
})
