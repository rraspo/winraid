import { describe, it, expect } from 'vitest'
import { listCommand, parseListOutput, readdirEntries } from './remote-list.js'

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

// The listing now carries every attribute Properties used to fetch in a
// second round trip. These cases pin the parser contract — what it lifts
// out of each line — so a regression in one path or the other breaks here
// before it reaches the dialog.
describe('parseListOutput — widened format', () => {
  // An arbitrarily-shaped find line exercising every column the listing now
  // carries: type, size, mtime, name, permission mode, owner name, group
  // name, uid, gid, symlink target. Implementer picks the column order and
  // the exact -printf directives — this test pins only the OUTCOME: every
  // column reaches a distinct, named entry field.
  const FILE_LINE   = 'f\t1024\t1700000000\treadme.txt\t644\talice\tstaff\t1000\t1000\t\n'
  const DIR_LINE    = 'd\t4096\t1700000050\tDocuments\t755\talice\tstaff\t1000\t1000\t\n'
  const SYMLINK_LINE = 'l\t10\t1700000100\tlink\t777\talice\tstaff\t1000\t1000\ttarget.mp4\n'

  it('parses permission mode, owner and group from a regular file line', () => {
    const entry = parseListOutput(FILE_LINE)[0]
    expect(entry.mode).toBe('644')
    expect(entry.owner).toBe('alice')
    expect(entry.group).toBe('staff')
  })

  it('parses permission mode from a directory line', () => {
    const entry = parseListOutput(DIR_LINE)[0]
    expect(entry.mode).toBe('755')
  })

  it('parses numeric uid and gid when the line carries them', () => {
    const entry = parseListOutput(FILE_LINE)[0]
    expect(entry.uid).toBe(1000)
    expect(entry.gid).toBe(1000)
  })

  it('surfaces the symlink target on a symlink line', () => {
    const entry = parseListOutput(SYMLINK_LINE)[0]
    expect(entry.target).toBe('target.mp4')
  })

  it('leaves the target null/undefined on a regular file line — never an empty-string artifact', () => {
    const entry = parseListOutput(FILE_LINE)[0]
    // Both null and undefined are acceptable for "no target" — the contract
    // is that the field is absent, not that it's been coerced to ''.
    expect(entry.target == null).toBe(true)
    expect(entry.target).not.toBe('')
  })

  it('still parses the existing type/size/mtime/name columns', () => {
    const out = parseListOutput(FILE_LINE)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      name: 'readme.txt',
      type: 'file',
      size: 1024,
      modified: 1700000000000,
    })
  })

  it('skips a truncated line that does not have enough columns to be a valid widened row', () => {
    // Only 3 columns — the original 4-column guard would let this through as
    // a 3-field row; the widened format must skip it instead of producing a
    // half-built entry.
    const out = parseListOutput('f\t1\t1\n' + FILE_LINE)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('readme.txt')
  })

  it('skips a line where the type column is empty', () => {
    const out = parseListOutput('\t1\t1\tok\n' + FILE_LINE)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('readme.txt')
  })
})

// The readdir fallback carried only what its attrs blob surfaced — type,
// size, mtime. Permissions, uid and gid were always in attrs but were
// dropped here, so Properties had to fetch them again per entry. These
// cases pin the new shape.
describe('readdirEntries — widened attributes', () => {
  const file = (overrides = {}) => ({
    filename: 'clip.mp4',
    attrs: {
      mode: 0o100644,
      uid: 1000,
      gid: 1000,
      size: 5242880,
      mtime: 1_700_000_000,
      ...overrides.attrs,
    },
  })

  it('preserves the permission bits from attrs.mode — not just the dir/file mask', () => {
    const [entry] = readdirEntries([file({ attrs: { mode: 0o100644, uid: 0, gid: 0, size: 0, mtime: 0 } })])
    // The implementer chooses whether to surface the full 0o100644 type bits
    // or just the permission subset (0o644); either way it must be a
    // permission string, not the boolean dir/file classification.
    expect(typeof entry.mode).toBe('string')
    expect(entry.mode).not.toBe('dir')
    expect(entry.mode).not.toBe('file')
  })

  it('surfaces uid and gid from the attrs blob', () => {
    const [entry] = readdirEntries([file()])
    expect(entry.uid).toBe(1000)
    expect(entry.gid).toBe(1000)
  })

  it('leaves the symlink target null/undefined — readdir has no readlink equivalent', () => {
    const [entry] = readdirEntries([file({ attrs: { mode: 0o120777, uid: 0, gid: 0, size: 0, mtime: 0 } })])
    expect(entry.target == null).toBe(true)
  })

  it('still surfaces the existing name/type/size/modified columns', () => {
    const [entry] = readdirEntries([file({ attrs: { mode: 0o100644, uid: 0, gid: 0, size: 12, mtime: 1_700_000_000 } })])
    expect(entry).toMatchObject({
      name: 'clip.mp4',
      type: 'file',
      size: 12,
      modified: 1_700_000_000_000,
    })
  })

  it('flags a directory from mode bits the same way as before', () => {
    const dirItem = {
      filename: 'Photos',
      attrs: { mode: 0o040755, uid: 1000, gid: 1000, size: 4096, mtime: 1_700_000_000 },
    }
    const [entry] = readdirEntries([dirItem])
    expect(entry.type).toBe('dir')
    expect(entry.name).toBe('Photos')
  })
})

// The two listing paths return equivalent information but source it
// differently: find can resolve names and readlink targets, readdir can
// only give numeric ids and has no link target. The contract is that
// callers see the same SHAPE — same keys, with documented nulls — so a
// Properties dialog wired against one path works against the other.
describe('both listing paths agree on entry shape', () => {
  // The key set a caller can read off either parser's entry. Implementers
  // may add extras; this is the floor. Updating this set is the right way
  // to communicate "every listing carries this field."
  const SHARED_KEYS = ['name', 'type', 'size', 'modified', 'mode', 'owner', 'group', 'uid', 'gid', 'target']

  it('a find-parsed entry exposes every shared key', () => {
    const findLine = 'f\t1024\t1700000000\treadme.txt\t644\talice\tstaff\t1000\t1000\t\n'
    const [entry] = parseListOutput(findLine)
    for (const key of SHARED_KEYS) expect(entry).toHaveProperty(key)
  })

  it('a readdir-parsed entry exposes every shared key', () => {
    const item = {
      filename: 'readme.txt',
      attrs: { mode: 0o100644, uid: 1000, gid: 1000, size: 1024, mtime: 1_700_000_000 },
    }
    const [entry] = readdirEntries([item])
    for (const key of SHARED_KEYS) expect(entry).toHaveProperty(key)
  })

  it('a readdir entry has null (not a wrong type) for fields readdir cannot supply', () => {
    const item = {
      filename: 'readme.txt',
      attrs: { mode: 0o100644, uid: 1000, gid: 1000, size: 1024, mtime: 1_700_000_000 },
    }
    const [entry] = readdirEntries([item])
    // readdir gives numeric ids only — owner name and group name are null,
    // not undefined-typed-as-something-else, and never the numeric id.
    expect(entry.owner == null).toBe(true)
    expect(entry.group == null).toBe(true)
    // Same contract for the symlink target.
    expect(entry.target == null).toBe(true)
  })

  it('a find entry exposes owner/group as strings and uid/gid as numbers, both consistent', () => {
    const findLine = 'f\t1024\t1700000000\treadme.txt\t644\talice\tstaff\t1000\t1000\t\n'
    const [entry] = parseListOutput(findLine)
    expect(typeof entry.owner).toBe('string')
    expect(typeof entry.group).toBe('string')
    expect(typeof entry.uid).toBe('number')
    expect(typeof entry.gid).toBe('number')
  })

  it('a readdir entry exposes uid/gid as numbers and leaves owner/group as null', () => {
    const item = {
      filename: 'readme.txt',
      attrs: { mode: 0o100644, uid: 1000, gid: 1000, size: 1024, mtime: 1_700_000_000 },
    }
    const [entry] = readdirEntries([item])
    expect(typeof entry.uid).toBe('number')
    expect(typeof entry.gid).toBe('number')
    expect(entry.owner == null).toBe(true)
    expect(entry.group == null).toBe(true)
  })
})
