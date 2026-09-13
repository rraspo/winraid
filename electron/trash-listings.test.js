// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { listCommand, parseListOutput, readdirEntries } from './remote-list.js'
import { buildRemoteTreeCommand } from './remote-tree-cmd.js'
import { TRASH_DIR, TRASH_META } from './trash.js'

// The trash lives inside the connection's own folder, so every way the browser
// reads that folder must leave it out — otherwise a deleted file is still shown
// as an ordinary one, and the Size map counts it.
//
// The find-based commands are run for real against a scratch directory rather
// than inspected as strings: what matters is what find prints, and a string
// check cannot tell an exclusion that prunes a subtree from one that only hides
// the directory entry itself. They need a POSIX shell with GNU find, so they do
// not run on Windows, where the commands never run either — they run on the NAS.
const posixShell = process.platform !== 'win32'

let root
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'winraid-trash-listing-'))
  mkdirSync(join(root, 'photos'))
  writeFileSync(join(root, 'photos', 'kept.jpg'), 'kept')
  mkdirSync(join(root, TRASH_DIR, 'entry1', 'album'), { recursive: true })
  writeFileSync(join(root, TRASH_DIR, 'entry1', 'album', 'deleted.jpg'), 'deleted')
  writeFileSync(join(root, TRASH_DIR, 'entry1', TRASH_META), '{}')
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const runShell = (command) => execFileSync('sh', ['-c', command], { encoding: 'utf8' })

describe.skipIf(!posixShell)('the find listing', () => {
  it('lists the connection folder without the trash', () => {
    const names = parseListOutput(runShell(listCommand(root))).map((entry) => entry.name)
    expect(names).toEqual(['photos'])
  })
})

describe.skipIf(!posixShell)('the tree command', () => {
  it('walks the connection folder without descending into the trash', () => {
    const relPaths = runShell(buildRemoteTreeCommand(root))
      .split('\n').filter(Boolean).map((line) => line.split('\t')[3])
    expect(relPaths.sort()).toEqual(['photos', 'photos/kept.jpg'])
  })
})

describe('the readdir fallback', () => {
  const dir = (filename) => ({ filename, attrs: { mode: 0o040755, size: 4096, mtime: 1_700_000_000 } })
  const file = (filename) => ({ filename, attrs: { mode: 0o100644, size: 12, mtime: 1_700_000_000 } })

  it('leaves the trash out of the entries it maps', () => {
    expect(readdirEntries([dir(TRASH_DIR), dir('photos'), file('notes.txt')])).toEqual([
      { name: 'photos', type: 'dir', size: 4096, modified: 1_700_000_000_000 },
      { name: 'notes.txt', type: 'file', size: 12, modified: 1_700_000_000_000 },
    ])
  })
})
