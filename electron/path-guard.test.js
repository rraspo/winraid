import { describe, it, expect } from 'vitest'
import { join, resolve, sep } from 'path'
import { isWithinBase } from './path-guard.js'

// Built with resolve()/join() rather than literals so the expectations hold on
// both CI runners — POSIX separators and Windows drive letters alike.
const base = resolve('/srv/watched')

describe('isWithinBase', () => {
  it('accepts a direct child and a nested descendant', () => {
    expect(isWithinBase(base, join(base, 'clip.mp4'))).toBe(true)
    expect(isWithinBase(base, join(base, 'a', 'b', 'clip.mp4'))).toBe(true)
  })

  it('rejects a traversal that climbs out of the base', () => {
    expect(isWithinBase(base, join(base, '..', 'escape.txt'))).toBe(false)
    expect(isWithinBase(base, join(base, 'a', '..', '..', 'escape.txt'))).toBe(false)
  })

  it('rejects an unrelated absolute path', () => {
    expect(isWithinBase(base, resolve('/etc/passwd'))).toBe(false)
  })

  // The trap the separator is there for: a plain prefix compare would accept
  // /srv/watched-evil as living inside /srv/watched.
  it('rejects a sibling whose name merely starts with the base', () => {
    expect(isWithinBase(base, resolve('/srv/watched-evil/loot.txt'))).toBe(false)
    expect(isWithinBase(base, resolve('/srv/watchedevil'))).toBe(false)
  })

  it('rejects the base itself — callers guard a location to put files in, not the folder', () => {
    expect(isWithinBase(base, base)).toBe(false)
  })

  it('normalises the base, so a trailing separator does not change the answer', () => {
    expect(isWithinBase(base + sep, join(base, 'clip.mp4'))).toBe(true)
  })

  it('normalises an unresolved candidate before comparing', () => {
    expect(isWithinBase(base, join(base, '.', 'a', '..', 'clip.mp4'))).toBe(true)
  })

  // A base that resolves to a filesystem root admits nothing. Callers that
  // could legitimately hold one (verify-delete) refuse a drive root earlier
  // with a clearer message, so failing closed here is the safe reading rather
  // than silently authorising the whole disk.
  it('admits nothing when the base is a filesystem root', () => {
    expect(isWithinBase(resolve('/'), resolve('/anything'))).toBe(false)
  })

  // One positive case per caller, built exactly the way that handler builds
  // its arguments, so a change to the helper cannot silently break a live path.
  describe('the shapes the callers pass', () => {
    it('queue:enqueue-batch — a relPath split on forward slashes', () => {
      const rel = 'season 1/ep01.mkv'
      expect(isWithinBase(base, join(base, ...rel.split('/')))).toBe(true)
      expect(isWithinBase(base, join(base, ...'../../etc/passwd'.split('/')))).toBe(false)
    })

    it('remote:verify-delete — an already-resolved base joined with a relative name', () => {
      const resolvedLF = resolve(base)
      expect(isWithinBase(resolvedLF, join(resolvedLF, 'clip.mp4'))).toBe(true)
      expect(isWithinBase(resolvedLF, join(resolvedLF, '..', 'clip.mp4'))).toBe(false)
    })

    it('backup:run — a destination joined with the remote relative path', () => {
      const localDest = resolve('/backups/nas')
      const relPath = 'photos/2026/img.jpg'
      expect(isWithinBase(localDest, join(localDest, ...relPath.split('/').filter(Boolean)))).toBe(true)
      expect(isWithinBase(localDest, join(localDest, ...'../escape/img.jpg'.split('/')))).toBe(false)
    })
  })

  it('rejects malformed input instead of throwing', () => {
    expect(isWithinBase(base, '')).toBe(false)
    expect(isWithinBase('', join(base, 'a.txt'))).toBe(false)
    expect(isWithinBase(base, null)).toBe(false)
    expect(isWithinBase(undefined, undefined)).toBe(false)
  })
})
