import { describe, it, expect, beforeEach } from 'vitest'
import {
  readAccordionMode, setAccordionMode,
  readExpandedConns, writeExpandedConns, initialExpanded,
  ACC_MODE_KEY,
} from './accordionMode'

beforeEach(() => localStorage.clear())

describe('readAccordionMode', () => {
  it('defaults to "expanded" when nothing is stored', () => {
    expect(readAccordionMode()).toBe('expanded')
  })

  it('returns the stored mode', () => {
    localStorage.setItem(ACC_MODE_KEY, 'remember')
    expect(readAccordionMode()).toBe('remember')
  })

  it('migrates the legacy "false" boolean key to "collapsed"', () => {
    localStorage.setItem('sidebar-accordions-default-open', 'false')
    expect(readAccordionMode()).toBe('collapsed')
  })

  it('migrates the legacy "true" boolean key to "expanded"', () => {
    localStorage.setItem('sidebar-accordions-default-open', 'true')
    expect(readAccordionMode()).toBe('expanded')
  })

  it('prefers the new key over the legacy key', () => {
    localStorage.setItem('sidebar-accordions-default-open', 'false')
    localStorage.setItem(ACC_MODE_KEY, 'remember')
    expect(readAccordionMode()).toBe('remember')
  })

  it('ignores an invalid stored mode and falls back', () => {
    localStorage.setItem(ACC_MODE_KEY, 'bogus')
    expect(readAccordionMode()).toBe('expanded')
  })
})

describe('initialExpanded', () => {
  const ids = ['a', 'b', 'c']

  it('expands everything in "expanded" mode', () => {
    expect(initialExpanded('expanded', ids, new Set())).toEqual(new Set(ids))
  })

  it('collapses everything in "collapsed" mode', () => {
    expect(initialExpanded('collapsed', ids, new Set(['a', 'b']))).toEqual(new Set())
  })

  it('restores the saved set in "remember" mode', () => {
    expect(initialExpanded('remember', ids, new Set(['a', 'c']))).toEqual(new Set(['a', 'c']))
  })

  it('drops saved ids that no longer exist', () => {
    expect(initialExpanded('remember', ids, new Set(['a', 'gone']))).toEqual(new Set(['a']))
  })
})

describe('readExpandedConns / writeExpandedConns', () => {
  it('round-trips a set of connection ids', () => {
    writeExpandedConns(new Set(['x', 'y']))
    expect(readExpandedConns()).toEqual(new Set(['x', 'y']))
  })

  it('returns an empty set when nothing is stored', () => {
    expect(readExpandedConns()).toEqual(new Set())
  })

  it('returns an empty set on corrupt JSON', () => {
    localStorage.setItem('sidebar-accordions-expanded', '{not json')
    expect(readExpandedConns()).toEqual(new Set())
  })
})

describe('setAccordionMode', () => {
  it('persists the mode', () => {
    setAccordionMode('collapsed')
    expect(readAccordionMode()).toBe('collapsed')
  })
})
