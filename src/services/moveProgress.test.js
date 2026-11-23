import { describe, it, expect, vi, afterEach } from 'vitest'
import * as moveProgress from './moveProgress'

// Contract: every move of files on the NAS registers here while it runs, so
// the shell can show it the way it shows transfers, whichever screen
// started it.

afterEach(() => moveProgress.clearAll())

describe('moveProgress', () => {
  it('lists a running move with its count and the item in flight', () => {
    const id = moveProgress.begin({ connectionId: 'c1', total: 3 })
    moveProgress.report(id, { done: 1, name: 'b.jpg' })
    expect(moveProgress.getSnapshot()).toEqual([{ id, connectionId: 'c1', total: 3, done: 1, name: 'b.jpg' }])
  })

  it('starts at zero done', () => {
    const id = moveProgress.begin({ connectionId: 'c1', total: 5 })
    expect(moveProgress.getSnapshot()[0]).toMatchObject({ id, done: 0, total: 5 })
  })

  it('drops a move once it ends', () => {
    const id = moveProgress.begin({ connectionId: 'c1', total: 1 })
    moveProgress.end(id)
    expect(moveProgress.getSnapshot()).toEqual([])
  })

  it('keeps moves apart when two run at once', () => {
    const first  = moveProgress.begin({ connectionId: 'c1', total: 2 })
    const second = moveProgress.begin({ connectionId: 'c2', total: 4 })
    moveProgress.end(first)
    expect(moveProgress.getSnapshot().map((move) => move.id)).toEqual([second])
  })

  it('tells subscribers about each change and stops when they unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = moveProgress.subscribe(listener)
    const id = moveProgress.begin({ connectionId: 'c1', total: 2 })
    moveProgress.report(id, { done: 1, name: 'a' })
    moveProgress.end(id)
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    moveProgress.begin({ connectionId: 'c1', total: 1 })
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('ignores reports for a move that already ended', () => {
    const id = moveProgress.begin({ connectionId: 'c1', total: 2 })
    moveProgress.end(id)
    moveProgress.report(id, { done: 1, name: 'late' })
    expect(moveProgress.getSnapshot()).toEqual([])
  })
})
