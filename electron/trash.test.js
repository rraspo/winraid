// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { TRASH_DIR, trashDestination, restoreDestination, expiredEntries, trashSize } from './trash.js'

// Contract under test — a remote delete is recoverable.
//
// Deleting on the NAS unlinked the file and that was the end of it. A trash
// keeps it: the delete becomes a move into a folder on the same share, so no
// bytes travel and the size of the file is irrelevant to how long it takes.
//
// This module owns only the decisions — where a deleted file goes, where it
// comes back to, and what has aged out. Performing the move is the caller's
// job, and it already knows how: the remote move runs `mv` over SSH and falls
// back to an SFTP rename, which is what makes this work on a mergerfs union
// where a plain rename fails across devices.
//
// Two files deleted from different folders can share a name, and the same
// file can be deleted twice, so every entry gets its own directory inside the
// trash rather than being dropped in flat.

const ROOT = '/mnt/user/media'

describe('where a deleted file goes', () => {
  it('moves it inside the connection’s own trash folder', () => {
    const dest = trashDestination(ROOT, '/mnt/user/media/photos/a.jpg', 'abc123')
    expect(dest.startsWith(`${ROOT}/${TRASH_DIR}/`)).toBe(true)
  })

  it('keeps the file’s own name, so the trash is readable', () => {
    const dest = trashDestination(ROOT, '/mnt/user/media/photos/a.jpg', 'abc123')
    expect(dest.endsWith('/a.jpg')).toBe(true)
  })

  it('gives each delete its own directory, so two files named alike never collide', () => {
    const first  = trashDestination(ROOT, '/mnt/user/media/photos/a.jpg', 'abc123')
    const second = trashDestination(ROOT, '/mnt/user/media/videos/a.jpg', 'def456')
    expect(first).not.toBe(second)
    expect(first.endsWith('/a.jpg')).toBe(true)
    expect(second.endsWith('/a.jpg')).toBe(true)
  })

  it('never nests the trash inside itself', () => {
    const already = `${ROOT}/${TRASH_DIR}/abc123/a.jpg`
    expect(() => trashDestination(ROOT, already, 'xyz')).toThrow(/already in the trash/i)
  })
})

describe('where a restored file comes back to', () => {
  const entry = {
    id: 'abc123',
    originalPath: '/mnt/user/media/photos/a.jpg',
    name: 'a.jpg',
    deletedAt: 1_700_000_000_000,
    size: 1024,
  }

  it('goes back where it came from', () => {
    expect(restoreDestination(entry)).toBe('/mnt/user/media/photos/a.jpg')
  })

  it('does not overwrite something that took its place', () => {
    expect(restoreDestination(entry, { exists: true })).toBe('/mnt/user/media/photos/a (restored).jpg')
  })

  it('keeps trying past the first taken name', () => {
    const taken = new Set(['/mnt/user/media/photos/a.jpg', '/mnt/user/media/photos/a (restored).jpg'])
    expect(restoreDestination(entry, { exists: (p) => taken.has(p) }))
      .toBe('/mnt/user/media/photos/a (restored 2).jpg')
  })
})

describe('what ages out of the trash', () => {
  const day = 24 * 60 * 60 * 1000
  const now = 1_700_000_000_000
  const entries = [
    { id: 'fresh', deletedAt: now - (2 * day),  size: 10 },
    { id: 'old',   deletedAt: now - (40 * day), size: 20 },
    { id: 'edge',  deletedAt: now - (30 * day), size: 30 },
  ]

  it('takes everything past the age limit', () => {
    expect(expiredEntries(entries, { now, maxAgeDays: 30 }).map((e) => e.id)).toEqual(['old', 'edge'])
  })

  it('keeps everything when the limit is off', () => {
    expect(expiredEntries(entries, { now, maxAgeDays: 0 })).toEqual([])
  })

  it('adds up what the trash is holding, so it can be shown before it is purged', () => {
    expect(trashSize(entries)).toBe(60)
  })

  it('copes with an empty trash', () => {
    expect(expiredEntries([], { now, maxAgeDays: 30 })).toEqual([])
    expect(trashSize([])).toBe(0)
  })
})
