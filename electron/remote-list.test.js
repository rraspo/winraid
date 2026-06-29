import { describe, it, expect } from 'vitest'
import { listCommand, parseListOutput } from './remote-list.js'

describe('listCommand', () => {
  it('uses a single find -printf — no per-file stat loop', () => {
    const cmd = listCommand('/media')
    expect(cmd).toContain("find -L '/media'")
    expect(cmd).toContain('-printf')
    expect(cmd).not.toContain('while')   // no per-file shell loop
    expect(cmd).not.toContain('stat ')   // no per-file stat process
    expect(cmd).not.toContain('basename')
  })

  it('escapes single quotes in the path', () => {
    expect(listCommand("/a'b")).toContain("'/a'\\''b'")
  })
})

describe('parseListOutput', () => {
  it('parses type/size/mtime(epoch)/name tab rows', () => {
    const out = 'd\t4096\t1700000000.5\tDocuments\nf\t1024\t1700000100\treadme.txt\n'
    expect(parseListOutput(out)).toEqual([
      { name: 'Documents', type: 'dir', size: 4096, modified: 1700000000500 },
      { name: 'readme.txt', type: 'file', size: 1024, modified: 1700000100000 },
    ])
  })

  it('treats non-d types (symlinks, etc.) as files', () => {
    expect(parseListOutput('l\t10\t0\tlink\n')[0].type).toBe('file')
  })

  it('skips malformed and empty lines', () => {
    expect(parseListOutput('garbage\n\nf\t1\t1\tok\n')).toHaveLength(1)
  })

  it('handles empty output', () => {
    expect(parseListOutput('')).toEqual([])
  })

  it('keeps names containing spaces intact', () => {
    expect(parseListOutput('f\t5\t0\tmy file.txt\n')[0].name).toBe('my file.txt')
  })
})
