import { describe, it, expect } from 'vitest'
import { SNAPSHOT_FORMATS, resolveSnapshotFormat } from './snapshotFormats'

describe('SNAPSHOT_FORMATS table', () => {
  it('contains exactly three entries: jpeg, png, webp', () => {
    expect(Object.keys(SNAPSHOT_FORMATS).sort()).toEqual(['jpeg', 'png', 'webp'])
  })

  it('jpeg entry uses image/jpeg mime, jpg ext, quality 0.92', () => {
    expect(SNAPSHOT_FORMATS.jpeg).toEqual({ mime: 'image/jpeg', ext: 'jpg', quality: 0.92 })
  })

  it('png entry uses image/png mime, png ext, undefined quality', () => {
    expect(SNAPSHOT_FORMATS.png).toEqual({ mime: 'image/png', ext: 'png', quality: undefined })
  })

  it('webp entry uses image/webp mime, webp ext, quality 0.92', () => {
    expect(SNAPSHOT_FORMATS.webp).toEqual({ mime: 'image/webp', ext: 'webp', quality: 0.92 })
  })
})

describe('resolveSnapshotFormat', () => {
  it('returns the JPEG triple for "jpeg"', () => {
    expect(resolveSnapshotFormat('jpeg')).toBe(SNAPSHOT_FORMATS.jpeg)
  })

  it('returns the PNG triple for "png"', () => {
    expect(resolveSnapshotFormat('png')).toBe(SNAPSHOT_FORMATS.png)
  })

  it('returns the WebP triple for "webp"', () => {
    expect(resolveSnapshotFormat('webp')).toBe(SNAPSHOT_FORMATS.webp)
  })

  it('falls back to JPEG for unknown keys', () => {
    expect(resolveSnapshotFormat('avif')).toBe(SNAPSHOT_FORMATS.jpeg)
    expect(resolveSnapshotFormat('')).toBe(SNAPSHOT_FORMATS.jpeg)
  })

  it('falls back to JPEG for null and undefined', () => {
    expect(resolveSnapshotFormat(null)).toBe(SNAPSHOT_FORMATS.jpeg)
    expect(resolveSnapshotFormat(undefined)).toBe(SNAPSHOT_FORMATS.jpeg)
  })
})
