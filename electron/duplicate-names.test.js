// @vitest-environment node
// Duplicate-name generation for the renameDuplicates connection setting:
// when a same-named file already exists on the remote, uploads land as
// "name (n).ext" (Windows Explorer convention) instead of overwriting or
// silently skipping.
import { describe, it, expect } from 'vitest'
import { duplicateName, findAvailableRelPath } from './duplicate-names.js'

describe('duplicateName', () => {
  it('inserts the counter before the extension', () => {
    expect(duplicateName('movie.mkv', 1)).toBe('movie (1).mkv')
    expect(duplicateName('movie.mkv', 12)).toBe('movie (12).mkv')
  })

  it('appends the counter when the file has no extension', () => {
    expect(duplicateName('README', 1)).toBe('README (1)')
  })

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(duplicateName('.env', 1)).toBe('.env (1)')
  })

  it('only splits on the last dot for multi-dot names', () => {
    expect(duplicateName('backup.tar.gz', 2)).toBe('backup.tar (2).gz')
  })

  it('renames only the basename of a nested rel path', () => {
    expect(duplicateName('shows/s01/ep1.mkv', 3)).toBe('shows/s01/ep1 (3).mkv')
  })
})

describe('findAvailableRelPath', () => {
  it('returns "name (1).ext" when only the original is taken', async () => {
    const taken = new Set(['movie.mkv'])
    const result = await findAvailableRelPath('movie.mkv', async (rel) => taken.has(rel))
    expect(result).toBe('movie (1).mkv')
  })

  it('skips past every taken counter to the first free one', async () => {
    const taken = new Set(['movie.mkv', 'movie (1).mkv', 'movie (2).mkv'])
    const result = await findAvailableRelPath('movie.mkv', async (rel) => taken.has(rel))
    expect(result).toBe('movie (3).mkv')
  })

  it('preserves the directory part while probing', async () => {
    const probed = []
    const result = await findAvailableRelPath('shows/s01/ep1.mkv', async (rel) => {
      probed.push(rel)
      return false
    })
    expect(result).toBe('shows/s01/ep1 (1).mkv')
    expect(probed).toEqual(['shows/s01/ep1 (1).mkv'])
  })

  it('gives up with an error instead of probing forever', async () => {
    await expect(findAvailableRelPath('movie.mkv', async () => true)).rejects.toThrow(/duplicate/i)
  })
})
