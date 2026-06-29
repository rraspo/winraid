import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initActivity, pushActivity, tailActivity, clearActivity, ACTIVITY_CAP } from './activity.js'

beforeEach(() => { clearActivity(); initActivity(null) })

describe('activity store', () => {
  it('stamps id + ts and stores the entry', () => {
    const e = pushActivity({ type: 'delete', level: 'info', title: 'Deleted x' })
    expect(typeof e.id).toBe('number')
    expect(typeof e.ts).toBe('number')
    expect(tailActivity(10)).toHaveLength(1)
    expect(tailActivity(10)[0].title).toBe('Deleted x')
  })

  it('returns entries most-recent-first', () => {
    pushActivity({ title: 'first' })
    pushActivity({ title: 'second' })
    expect(tailActivity(10).map((e) => e.title)).toEqual(['second', 'first'])
  })

  it('assigns increasing ids', () => {
    const a = pushActivity({ title: 'a' })
    const b = pushActivity({ title: 'b' })
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('caps the buffer, dropping the oldest', () => {
    for (let i = 0; i < ACTIVITY_CAP + 5; i++) pushActivity({ title: `t${i}` })
    const all = tailActivity(ACTIVITY_CAP + 100)
    expect(all).toHaveLength(ACTIVITY_CAP)
    expect(all[0].title).toBe(`t${ACTIVITY_CAP + 4}`)      // newest
    expect(all.some((e) => e.title === 't0')).toBe(false)  // oldest dropped
  })

  it('sends activity:entry through the injected sender', () => {
    const send = vi.fn()
    initActivity(send)
    const e = pushActivity({ title: 'ping' })
    expect(send).toHaveBeenCalledWith('activity:entry', e)
  })

  it('clearActivity empties the buffer', () => {
    pushActivity({ title: 'x' })
    clearActivity()
    expect(tailActivity(10)).toHaveLength(0)
  })
})
