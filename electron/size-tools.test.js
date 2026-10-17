import { describe, it, expect } from 'vitest'
import {
  pickSizeTool, sizeCommand, parseSizeKb, probeCommand, parseProbe,
  parseMounts, isMountPoint, toolForPath,
} from './size-tools.js'

describe('pickSizeTool', () => {
  it('prefers the faster tool when available', () => {
    expect(pickSizeTool(new Set(['diskus', 'du']))).toBe('diskus')
  })
  it('falls back to du when only du is present', () => {
    expect(pickSizeTool(new Set(['du']))).toBe('du')
  })
  it('falls back to du when nothing/unknown is present', () => {
    expect(pickSizeTool(new Set())).toBe('du')
    expect(pickSizeTool(new Set(['ncdu']))).toBe('du')
  })
})

describe('sizeCommand', () => {
  it('builds a du command in kilobytes that stays on one filesystem', () => {
    expect(sizeCommand('du', '/mnt/data')).toBe("du -skx '/mnt/data'")
  })
  it('builds a diskus command in bytes', () => {
    expect(sizeCommand('diskus', '/mnt/data')).toBe("diskus -b '/mnt/data'")
  })
  it('escapes single quotes in the path', () => {
    expect(sizeCommand('du', "/mnt/a'b")).toBe("du -skx '/mnt/a'\\''b'")
  })
})

describe('parseMounts', () => {
  const procMounts = [
    '/dev/sda2 / ext4 rw,relatime 0 0',
    'proc /proc proc rw,nosuid 0 0',
    'systemd-1 /mnt/nas autofs rw,relatime 0 0',
    'nas.local:/mnt/user/media /mnt/nas nfs rw,relatime 0 0',
    '/dev/loop1 /snap/core22/2437 squashfs ro 0 0',
    '/dev/sdb1 /mnt/my\\040disk ext4 rw 0 0',
  ].join('\n')

  it('returns the unique mount targets', () => {
    expect(parseMounts(procMounts)).toEqual(['/', '/proc', '/mnt/nas', '/snap/core22/2437', '/mnt/my disk'])
  })
  it('returns an empty list for empty or missing output', () => {
    expect(parseMounts('')).toEqual([])
    expect(parseMounts(undefined)).toEqual([])
  })
})

describe('isMountPoint', () => {
  const mounts = ['/', '/proc', '/mnt/nas']
  it('is true for a listed mount target', () => {
    expect(isMountPoint('/mnt/nas', mounts)).toBe(true)
  })
  it('ignores a trailing slash', () => {
    expect(isMountPoint('/mnt/nas/', mounts)).toBe(true)
  })
  it('is false for a plain folder', () => {
    expect(isMountPoint('/mnt', mounts)).toBe(false)
  })
})

describe('toolForPath', () => {
  const mounts = ['/', '/mnt/nas']
  it('keeps diskus when no other filesystem is mounted below the path', () => {
    expect(toolForPath('diskus', '/home', mounts)).toBe('diskus')
  })
  it('switches diskus to du when another filesystem is mounted below the path', () => {
    expect(toolForPath('diskus', '/mnt', mounts)).toBe('du')
  })
  it('does not treat a sibling with a shared prefix as below the path', () => {
    expect(toolForPath('diskus', '/mn', mounts)).toBe('diskus')
  })
  it('leaves du as du', () => {
    expect(toolForPath('du', '/mnt', mounts)).toBe('du')
  })
})

describe('parseSizeKb', () => {
  it('parses du tab-separated output as KB', () => {
    expect(parseSizeKb('du', '1024\t/mnt/data')).toBe(1024)
  })
  it('parses busybox du space-separated output', () => {
    expect(parseSizeKb('du', '512   /mnt/data')).toBe(512)
  })
  it('parses diskus byte count into KB', () => {
    expect(parseSizeKb('diskus', '1048576')).toBe(1024)
  })
  it('strips thousands separators from diskus output', () => {
    expect(parseSizeKb('diskus', '1,048,576')).toBe(1024)
  })
  it('returns null for human-readable diskus output (forces du fallback)', () => {
    expect(parseSizeKb('diskus', '1.85 GB (1985 bytes)')).toBeNull()
  })
  it('returns null for empty output', () => {
    expect(parseSizeKb('du', '')).toBeNull()
    expect(parseSizeKb('diskus', '   ')).toBeNull()
  })
})

describe('probeCommand / parseProbe', () => {
  it('builds a probe that echoes each present tool', () => {
    expect(probeCommand(['diskus', 'du'])).toBe(
      'command -v diskus >/dev/null 2>&1 && echo diskus; command -v du >/dev/null 2>&1 && echo du'
    )
  })
  it('parses probe output into a set of names', () => {
    expect(parseProbe('diskus\ndu\n')).toEqual(new Set(['diskus', 'du']))
    expect(parseProbe('')).toEqual(new Set())
  })
})
