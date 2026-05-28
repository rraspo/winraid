import { describe, it, expect } from 'vitest'
import { sortEntries } from './sortEntries'

const ENTRIES = [
  { name: 'banana.txt', type: 'file', size: 10, modified: 300 },
  { name: 'docs',       type: 'dir',  size: 0,  modified: 100 },
  { name: 'apple.txt',  type: 'file', size: 20, modified: 200 },
  { name: 'photos',     type: 'dir',  size: 0,  modified: 400 },
]

describe('sortEntries', () => {
  describe('nameAsc (dirs-first)', () => {
    it('sorts directories first, then files alphabetically A-Z', () => {
      const result = sortEntries(ENTRIES, 'nameAsc', true)
      expect(result.map((e) => e.name)).toEqual(['docs', 'photos', 'apple.txt', 'banana.txt'])
    })
  })

  describe('nameAsc (no dirs-first)', () => {
    it('sorts everything alphabetically A-Z regardless of type', () => {
      const result = sortEntries(ENTRIES, 'nameAsc', false)
      expect(result.map((e) => e.name)).toEqual(['apple.txt', 'banana.txt', 'docs', 'photos'])
    })
  })

  describe('nameDesc (dirs-first)', () => {
    it('sorts directories first Z-A, then files Z-A', () => {
      const result = sortEntries(ENTRIES, 'nameDesc', true)
      expect(result.map((e) => e.name)).toEqual(['photos', 'docs', 'banana.txt', 'apple.txt'])
    })
  })

  describe('nameDesc (no dirs-first)', () => {
    it('sorts everything Z-A', () => {
      const result = sortEntries(ENTRIES, 'nameDesc', false)
      expect(result.map((e) => e.name)).toEqual(['photos', 'docs', 'banana.txt', 'apple.txt'])
    })
  })

  describe('recent (dirs-first)', () => {
    it('sorts dirs newest-first, then files newest-first', () => {
      const result = sortEntries(ENTRIES, 'recent', true)
      expect(result.map((e) => e.name)).toEqual(['photos', 'docs', 'banana.txt', 'apple.txt'])
    })
  })

  describe('recent (no dirs-first)', () => {
    it('interleaves all entries newest-first', () => {
      const result = sortEntries(ENTRIES, 'recent', false)
      expect(result.map((e) => e.name)).toEqual(['photos', 'banana.txt', 'apple.txt', 'docs'])
    })
  })

  describe('oldest (dirs-first)', () => {
    it('sorts dirs oldest-first, then files oldest-first', () => {
      const result = sortEntries(ENTRIES, 'oldest', true)
      expect(result.map((e) => e.name)).toEqual(['docs', 'photos', 'apple.txt', 'banana.txt'])
    })
  })

  describe('oldest (no dirs-first)', () => {
    it('interleaves all entries oldest-first', () => {
      const result = sortEntries(ENTRIES, 'oldest', false)
      expect(result.map((e) => e.name)).toEqual(['docs', 'apple.txt', 'banana.txt', 'photos'])
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      expect(sortEntries([], 'nameAsc', true)).toEqual([])
    })

    it('does not mutate the original array', () => {
      const original = [...ENTRIES]
      sortEntries(ENTRIES, 'recent', false)
      expect(ENTRIES).toEqual(original)
    })

    it('handles entries with same modified timestamp stably', () => {
      const tied = [
        { name: 'b.txt', type: 'file', size: 1, modified: 100 },
        { name: 'a.txt', type: 'file', size: 1, modified: 100 },
      ]
      const result = sortEntries(tied, 'recent', false)
      expect(result.map((e) => e.name)).toEqual(['a.txt', 'b.txt'])
    })

    it('falls back to nameAsc for unknown mode', () => {
      const result = sortEntries(ENTRIES, 'bogus', true)
      expect(result.map((e) => e.name)).toEqual(['docs', 'photos', 'apple.txt', 'banana.txt'])
    })
  })
})
