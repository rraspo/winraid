import { describe, it, expect } from 'vitest'
import { normalizeForSearch } from './normalizeForSearch'

describe('normalizeForSearch', () => {
  it('normalizes an accented name and its unaccented query to the same value', () => {
    expect(normalizeForSearch('Andrés')).toBe(normalizeForSearch('andres'))
  })

  it('folds every vowel accent to its plain ASCII vowel', () => {
    expect(normalizeForSearch('ÁÉÍÓÚ')).toBe('aeiou')
  })

  // Recorded decision: NFD + combining-mark stripping folds n with a tilde to a
  // plain n, so "ano" matches "año". In Spanish, ñ is its own letter, not an
  // accented n — this is the accepted trade-off for accent-insensitive search
  // per the house rule (case- and accent-insensitive by default), not a bug.
  it('folds n-with-tilde to a plain n as an intentional trade-off', () => {
    expect(normalizeForSearch('Ñ')).toBe('n')
    expect(normalizeForSearch('año')).toBe('ano')
  })

  it('returns an already-ASCII string unchanged apart from case-folding', () => {
    expect(normalizeForSearch('banana.txt')).toBe('banana.txt')
  })

  it('does not throw on an empty string', () => {
    expect(normalizeForSearch('')).toBe('')
  })

  it('does not throw on a string made only of combining marks', () => {
    expect(() => normalizeForSearch('́̀̂')).not.toThrow()
    expect(normalizeForSearch('́̀̂')).toBe('')
  })
})
