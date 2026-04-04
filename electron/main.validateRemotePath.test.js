// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { validateRemotePath } from './validation.js'

describe('validateRemotePath', () => {
  // --- valid paths ---
  it('accepts a simple absolute path', () => {
    expect(validateRemotePath('/mnt/user/data')).toBe(true)
  })
  it('accepts root slash', () => {
    expect(validateRemotePath('/')).toBe(true)
  })
  it('accepts a deep nested path', () => {
    expect(validateRemotePath('/mnt/user/data/Documents/2024')).toBe(true)
  })
  it('accepts hidden directory names (dot-prefix, not traversal)', () => {
    expect(validateRemotePath('/mnt/user/..hidden')).toBe(true)
  })
  it('accepts three-dot names', () => {
    expect(validateRemotePath('/mnt/user/...dots')).toBe(true)
  })

  // --- invalid paths ---
  it('rejects empty string', () => {
    expect(validateRemotePath('')).toBe(false)
  })
  it('rejects relative path (no leading slash)', () => {
    expect(validateRemotePath('relative/path')).toBe(false)
  })
  it('rejects traversal segment in middle', () => {
    expect(validateRemotePath('/mnt/../etc/passwd')).toBe(false)
  })
  it('rejects traversal segment at end', () => {
    expect(validateRemotePath('/mnt/user/data/..')).toBe(false)
  })
  it('rejects multi-level traversal', () => {
    expect(validateRemotePath('/mnt/user/../../etc')).toBe(false)
  })
  it('rejects null byte in path', () => {
    expect(validateRemotePath('/valid/path\0injected')).toBe(false)
  })
  it('rejects null', () => {
    expect(validateRemotePath(null)).toBe(false)
  })
  it('rejects a number', () => {
    expect(validateRemotePath(123)).toBe(false)
  })
  it('rejects undefined', () => {
    expect(validateRemotePath(undefined)).toBe(false)
  })
  it('accepts a path with trailing newline (callers must trim)', () => {
    expect(validateRemotePath('/mnt/user/data\n')).toBe(true)
  })
})
