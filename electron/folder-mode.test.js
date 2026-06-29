import { describe, it, expect } from 'vitest'
import { shouldPruneEmptyDirs } from './folder-mode.js'

describe('shouldPruneEmptyDirs', () => {
  it('prunes for mirror_clean when keepEmptyDirs is off or absent', () => {
    expect(shouldPruneEmptyDirs({ folderMode: 'mirror_clean' })).toBe(true)
    expect(shouldPruneEmptyDirs({ folderMode: 'mirror_clean', keepEmptyDirs: false })).toBe(true)
  })

  it('does not prune for mirror_clean when keepEmptyDirs is on', () => {
    expect(shouldPruneEmptyDirs({ folderMode: 'mirror_clean', keepEmptyDirs: true })).toBe(false)
  })

  it('never prunes for flat or mirror, regardless of keepEmptyDirs', () => {
    expect(shouldPruneEmptyDirs({ folderMode: 'flat' })).toBe(false)
    expect(shouldPruneEmptyDirs({ folderMode: 'mirror' })).toBe(false)
    expect(shouldPruneEmptyDirs({ folderMode: 'mirror', keepEmptyDirs: true })).toBe(false)
  })
})
