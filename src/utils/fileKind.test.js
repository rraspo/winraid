import { describe, it, expect } from 'vitest'
import { fileKind } from './fileKind'

// Contract under test — the list view's Kind column derives a human label
// from the entry's type and file extension, never from reading file bytes:
// an extension map is a lookup, a mime-sniff would need a round trip to the
// remote connection for every visible row, which a listing column doesn't
// justify.
describe('fileKind', () => {
  it('labels a folder as a file folder', () => {
    expect(fileKind({ name: 'Photos', type: 'dir' })).toBe('File folder')
  })

  it('labels the media types the app already handles specially', () => {
    expect(fileKind({ name: 'sunrise.jpg', type: 'file' })).toBe('JPEG image')
    expect(fileKind({ name: 'poster.png', type: 'file' })).toBe('PNG image')
    expect(fileKind({ name: 'family-trip.mp4', type: 'file' })).toBe('MP4 video')
    expect(fileKind({ name: 'clip.mkv', type: 'file' })).toBe('MKV video')
  })

  it('falls back to the uppercased extension for an unrecognized type', () => {
    expect(fileKind({ name: 'archive.xyz', type: 'file' })).toBe('XYZ file')
  })

  it('falls back to a plain label for an extensionless file', () => {
    expect(fileKind({ name: 'Dockerfile', type: 'file' })).toBe('File')
  })
})
