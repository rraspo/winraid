// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { CONFIG_SET_ALLOWLIST } from './config-allowlist.js'

// Contract under test — every setting the app offers can actually be saved.
//
// Writes from the renderer are checked against an allowlist in main, and a
// key that is not on it is refused. The refusal is a return value nobody
// reads, so a setting whose key was never added to the list looks completely
// normal: the control moves, the screen updates, and the value is gone on
// restart. That is how the default-connection setting shipped unable to
// save, and it was only visible by using the built app.
//
// So the list is held against the source: every key the renderer writes must
// be on it. This test fails the moment a new setting is added without one.

const here = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(here, '..', 'src')

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found)
    } else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name) && !full.includes('__mocks__')) {
      found.push(full)
    }
  }
  return found
}

// Every `config.set('<key>'...)` the renderer makes, as its top-level key.
function keysWrittenByRenderer() {
  const writes = new Map()
  for (const file of sourceFiles(rendererRoot)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/config\s*\.\s*set\(\s*['"]([^'"]+)['"]/g)) {
      const topKey = match[1].split('.')[0]
      if (!writes.has(topKey)) writes.set(topKey, file.slice(rendererRoot.length + 1))
    }
  }
  return writes
}

describe('config write allowlist', () => {
  it('covers every key the renderer writes', () => {
    const writes = keysWrittenByRenderer()
    const missing = [...writes.entries()]
      .filter(([key]) => !CONFIG_SET_ALLOWLIST.includes(key))
      .map(([key, file]) => `${key} (written by ${file})`)

    expect(missing).toEqual([])
  })

  it('finds the writes at all, so a silent regex failure cannot pass this', () => {
    const writes = keysWrittenByRenderer()
    expect(writes.size).toBeGreaterThan(4)
    expect([...writes.keys()]).toContain('appearance')
  })

  it('includes the default connection, which shipped missing from it', () => {
    expect(CONFIG_SET_ALLOWLIST).toContain('defaultConnection')
  })
})
