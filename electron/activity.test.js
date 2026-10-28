import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initActivity, pushActivity, tailActivity, clearActivity, flushActivity, ACTIVITY_CAP } from './activity.js'

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

// The history survives restarts the way the transfer queue does: written to
// a file in userData, read back when the app starts.
describe('activity persistence', () => {
  let dir
  let file

  beforeEach(() => {
    dir  = mkdtempSync(join(tmpdir(), 'winraid-activity-'))
    file = join(dir, 'activity.json')
  })

  afterEach(() => {
    initActivity(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads back what was recorded before a restart, newest first', () => {
    initActivity(null, { filePath: file })
    pushActivity({ title: 'first' })
    pushActivity({ title: 'second' })
    flushActivity()

    initActivity(null, { filePath: file })
    expect(tailActivity(10).map((e) => e.title)).toEqual(['second', 'first'])
  })

  it('keeps ids increasing across a restart so entries never collide', () => {
    initActivity(null, { filePath: file })
    const before = pushActivity({ title: 'before' })
    flushActivity()

    initActivity(null, { filePath: file })
    const after = pushActivity({ title: 'after' })
    expect(after.id).toBeGreaterThan(before.id)
  })

  it('clearing the history empties the file too', () => {
    initActivity(null, { filePath: file })
    pushActivity({ title: 'x' })
    clearActivity()
    flushActivity()

    initActivity(null, { filePath: file })
    expect(tailActivity(10)).toHaveLength(0)
  })

  it('starts empty when the file is missing or corrupt', () => {
    writeFileSync(file, '{ not json', 'utf8')
    initActivity(null, { filePath: file })
    expect(tailActivity(10)).toHaveLength(0)
    expect(() => pushActivity({ title: 'still works' })).not.toThrow()
  })

  it('writes the file atomically, never leaving a half-written history behind', () => {
    initActivity(null, { filePath: file })
    pushActivity({ title: 'x' })
    flushActivity()
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8')).entries).toHaveLength(1)
  })
})
