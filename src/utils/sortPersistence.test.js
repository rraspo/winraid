import { describe, it, expect, beforeEach } from 'vitest'
import { resolveSortMode, saveSortMode, clearSortPrefs } from './sortPersistence'

beforeEach(() => {
  localStorage.clear()
})

describe('resolveSortMode — default persistence', () => {
  it('returns nameAsc when nothing is saved', () => {
    expect(resolveSortMode('/media', 'default')).toBe('nameAsc')
  })

  it('ignores saved per-folder prefs', () => {
    saveSortMode('/media', 'recent', 'default')
    expect(resolveSortMode('/media', 'default')).toBe('nameAsc')
  })
})

describe('resolveSortMode — folder persistence', () => {
  it('returns saved mode for exact path', () => {
    saveSortMode('/media/photos', 'recent', 'folder')
    expect(resolveSortMode('/media/photos', 'folder')).toBe('recent')
  })

  it('does not bleed to sibling paths', () => {
    saveSortMode('/media/photos', 'recent', 'folder')
    expect(resolveSortMode('/media/videos', 'folder')).toBe('nameAsc')
  })

  it('does not bleed to child paths', () => {
    saveSortMode('/media/photos', 'recent', 'folder')
    expect(resolveSortMode('/media/photos/2024', 'folder')).toBe('nameAsc')
  })
})

describe('resolveSortMode — siblings persistence', () => {
  it('returns saved mode for any child of the same parent', () => {
    saveSortMode('/media/photos/2024', 'oldest', 'siblings')
    expect(resolveSortMode('/media/photos/2024', 'siblings')).toBe('oldest')
    expect(resolveSortMode('/media/photos/2025', 'siblings')).toBe('oldest')
    expect(resolveSortMode('/media/photos/vacation', 'siblings')).toBe('oldest')
  })

  it('does not bleed to the parent itself', () => {
    saveSortMode('/media/photos/2024', 'oldest', 'siblings')
    expect(resolveSortMode('/media/photos', 'siblings')).toBe('nameAsc')
  })

  it('does not bleed to cousins in a different subtree', () => {
    saveSortMode('/media/photos/2024', 'oldest', 'siblings')
    expect(resolveSortMode('/media/videos/clips', 'siblings')).toBe('nameAsc')
  })
})

describe('saveSortMode', () => {
  it('overwrites previous value for same path', () => {
    saveSortMode('/media', 'recent', 'folder')
    saveSortMode('/media', 'nameDesc', 'folder')
    expect(resolveSortMode('/media', 'folder')).toBe('nameDesc')
  })
})

describe('clearSortPrefs', () => {
  it('removes all saved sort preferences', () => {
    saveSortMode('/a', 'recent', 'folder')
    saveSortMode('/b', 'oldest', 'siblings')
    clearSortPrefs()
    expect(resolveSortMode('/a', 'folder')).toBe('nameAsc')
    expect(resolveSortMode('/b', 'siblings')).toBe('nameAsc')
  })
})
