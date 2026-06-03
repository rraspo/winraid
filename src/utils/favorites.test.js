import { describe, it, expect } from 'vitest'
import { isFavorite, toggleFavorite, favName } from './favorites'

describe('isFavorite', () => {
  it('matches an exact path', () => {
    expect(isFavorite(['/a/b', '/a/c'], '/a/b')).toBe(true)
  })
  it('ignores a trailing slash on either side', () => {
    expect(isFavorite(['/a/b'], '/a/b/')).toBe(true)
    expect(isFavorite(['/a/b/'], '/a/b')).toBe(true)
  })
  it('returns false when absent', () => {
    expect(isFavorite(['/a/b'], '/a/x')).toBe(false)
  })
  it('handles an empty/undefined list', () => {
    expect(isFavorite([], '/a/b')).toBe(false)
    expect(isFavorite(undefined, '/a/b')).toBe(false)
  })
})

describe('toggleFavorite', () => {
  it('adds a path that is not present', () => {
    expect(toggleFavorite(['/a/b'], '/a/c')).toEqual(['/a/b', '/a/c'])
  })
  it('removes a path that is present', () => {
    expect(toggleFavorite(['/a/b', '/a/c'], '/a/b')).toEqual(['/a/c'])
  })
  it('removes by normalized path (trailing slash)', () => {
    expect(toggleFavorite(['/a/b'], '/a/b/')).toEqual([])
  })
  it('stores the normalized path when adding (no trailing slash)', () => {
    expect(toggleFavorite([], '/a/b/')).toEqual(['/a/b'])
  })
  it('does not mutate the input array', () => {
    const input = ['/a/b']
    toggleFavorite(input, '/a/c')
    expect(input).toEqual(['/a/b'])
  })
  it('treats undefined list as empty', () => {
    expect(toggleFavorite(undefined, '/a/b')).toEqual(['/a/b'])
  })
  it('keeps root "/" intact (not stripped to empty)', () => {
    expect(toggleFavorite([], '/')).toEqual(['/'])
  })
})

describe('favName', () => {
  it('returns the last path segment', () => {
    expect(favName('/mnt/user/media')).toBe('media')
  })
  it('returns "/" for root', () => {
    expect(favName('/')).toBe('/')
  })
  it('ignores a trailing slash', () => {
    expect(favName('/mnt/user/media/')).toBe('media')
  })
})
