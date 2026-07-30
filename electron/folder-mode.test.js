import { describe, it, expect } from 'vitest'
import { shouldPruneEmptyDirs, deletesLocalAfterUpload } from './folder-mode.js'

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

describe('deletesLocalAfterUpload', () => {
  it('is true for the move operation in any folder mode', () => {
    expect(deletesLocalAfterUpload({ operation: 'move', folderMode: 'flat' })).toBe(true)
    expect(deletesLocalAfterUpload({ operation: 'move', folderMode: 'mirror' })).toBe(true)
  })

  it('is true for mirror_clean even with the copy operation', () => {
    expect(deletesLocalAfterUpload({ operation: 'copy', folderMode: 'mirror_clean' })).toBe(true)
  })

  it('is false for copy connections in flat or mirror mode', () => {
    expect(deletesLocalAfterUpload({ operation: 'copy', folderMode: 'flat' })).toBe(false)
    expect(deletesLocalAfterUpload({ operation: 'copy', folderMode: 'mirror' })).toBe(false)
    expect(deletesLocalAfterUpload({})).toBe(false)
  })
})
