import { describe, it, expect } from 'vitest'
import { pickSizeTool, sizeCommand, parseSizeKb, probeCommand, parseProbe } from './size-tools.js'

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
  it('builds a du command in kilobytes', () => {
    expect(sizeCommand('du', '/mnt/data')).toBe("du -sk '/mnt/data'")
  })
  it('builds a diskus command in bytes', () => {
    expect(sizeCommand('diskus', '/mnt/data')).toBe("diskus -b '/mnt/data'")
  })
  it('escapes single quotes in the path', () => {
    expect(sizeCommand('du', "/mnt/a'b")).toBe("du -sk '/mnt/a'\\''b'")
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
