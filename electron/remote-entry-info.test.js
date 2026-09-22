// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { entryInfoCommand, readlinkCommand, parseEntryInfoOutput, formatMode } from './remote-entry-info.js'

describe('entryInfoCommand', () => {
  it('stats the path itself without following a symlink', () => {
    const cmd = entryInfoCommand('/mnt/user/media/clip.mp4')
    expect(cmd).toContain("stat -c '%a\\t%U\\t%G\\t%W\\t%F'")
    expect(cmd).toContain("'/mnt/user/media/clip.mp4'")
    expect(cmd).not.toContain(' -L')
  })

  it('escapes single quotes in the path', () => {
    expect(entryInfoCommand("/a'b")).toContain("'/a'\\''b'")
  })
})

describe('readlinkCommand', () => {
  it('reads the immediate target, not the fully resolved one', () => {
    const cmd = readlinkCommand('/mnt/user/media/shortcut')
    expect(cmd).toBe("readlink -- '/mnt/user/media/shortcut'")
    expect(cmd).not.toContain('-f')
  })
})

describe('parseEntryInfoOutput', () => {
  it('parses mode/owner/group/type for a regular file', () => {
    const out = parseEntryInfoOutput('644\tuser\tusers\t0\tregular file\n')
    expect(out).toEqual({ mode: '644', owner: 'user', group: 'users', created: null, isSymlink: false })
  })

  it('parses a directory', () => {
    const out = parseEntryInfoOutput('755\tuser\tusers\t1700000000\tdirectory\n')
    expect(out.isSymlink).toBe(false)
    expect(out.created).toBe(1700000000000)
  })

  it('flags a symbolic link', () => {
    const out = parseEntryInfoOutput('777\tuser\tusers\t0\tsymbolic link\n')
    expect(out.isSymlink).toBe(true)
  })

  it('treats a birth time of 0 as not reported', () => {
    expect(parseEntryInfoOutput('644\tuser\tusers\t0\tregular file\n').created).toBeNull()
  })

  it('returns null for malformed output', () => {
    expect(parseEntryInfoOutput('garbage')).toBeNull()
    expect(parseEntryInfoOutput('')).toBeNull()
  })
})

describe('formatMode', () => {
  it('renders the classic rwx triplet', () => {
    expect(formatMode('755')).toBe('rwxr-xr-x')
    expect(formatMode('644')).toBe('rw-r--r--')
    expect(formatMode('600')).toBe('rw-------')
  })

  it('uses only the last three digits when a leading special-bits digit is present', () => {
    expect(formatMode('0755')).toBe('rwxr-xr-x')
  })

  it('returns null for input that is not an octal mode', () => {
    expect(formatMode('abc')).toBeNull()
    expect(formatMode('')).toBeNull()
    expect(formatMode(undefined)).toBeNull()
  })
})
