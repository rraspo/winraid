// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { watchableConnections } from './watchable.js'

// Contract under test — "Resume all" means all.
//
// Resuming used to restart only the connections that happened to be running
// at the moment "Pause all" was pressed. A connection that was stopped at
// that moment was never in that set, so no amount of pausing and resuming
// would ever start it again, and resuming without a prior pause started
// nothing at all. The button named "all" was the one thing that could not
// reach a stopped connection.
//
// What can be watched is decided from the connections themselves: a watch
// folder that is configured and actually present on disk. Anything else is
// reported with a reason rather than skipped in silence.

const FOLDERS = {
  'C:\\present': true,
  'C:\\also-present': true,
}
const folderExists = (path) => FOLDERS[path] === true

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas',   localFolder: 'C:\\present' },
  { id: 'c2', name: 'Vault',   localFolder: 'C:\\also-present' },
  { id: 'c3', name: 'Archive', localFolder: 'C:\\gone' },
  { id: 'c4', name: 'Remote',  localFolder: '' },
]

describe('which connections can be watched', () => {
  it('takes every connection whose watch folder is there', () => {
    const { startable } = watchableConnections(CONNECTIONS, folderExists)
    expect(startable.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('does not care what was running before', () => {
    // The whole point: the answer depends on the connections, not on history.
    const { startable } = watchableConnections(CONNECTIONS, folderExists)
    expect(startable.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('says why a connection cannot be watched', () => {
    const { blocked } = watchableConnections(CONNECTIONS, folderExists)
    expect(blocked).toEqual([
      { id: 'c3', name: 'Archive', reason: 'folder-missing' },
      { id: 'c4', name: 'Remote',  reason: 'no-folder' },
    ])
  })

  it('treats a folder it cannot check as missing rather than throwing', () => {
    const throwing = () => { throw new Error('EPERM') }
    const { startable, blocked } = watchableConnections([CONNECTIONS[0]], throwing)
    expect(startable).toEqual([])
    expect(blocked).toEqual([{ id: 'c1', name: 'Atlas', reason: 'folder-missing' }])
  })

  it('copes with no connections at all', () => {
    expect(watchableConnections([], folderExists)).toEqual({ startable: [], blocked: [] })
    expect(watchableConnections(undefined, folderExists)).toEqual({ startable: [], blocked: [] })
  })
})
