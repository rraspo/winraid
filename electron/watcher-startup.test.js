// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planLaunchWatchers, withWatchIntent } from './watcher-startup.js'
import { CONFIG_SET_ALLOWLIST } from './config-allowlist.js'

// Contract under test — a watcher the user left on is on again after a
// restart, a watcher the user stopped stays stopped, and a connection that
// cannot be watched says why instead of disappearing.
//
// Decision: watcher on/off intent persists across restarts. Main owns it as a
// top-level `stoppedWatchers` list of connection ids — the ids the user
// explicitly stopped. Everything else auto-starts when its folder is present,
// so existing configs (no list yet) keep auto-starting every connection.
// Pause all is a temporary, session-only pause and does not touch the list;
// Start, Stop and Resume all do.
//
// The list lives outside `connections` on purpose: the renderer rewrites the
// whole connections array whenever it saves one, and a flag stored inside it
// would be clobbered by whatever stale copy the renderer held.

const { getUserDataDir, setUserDataDir } = vi.hoisted(() => {
  let dir = ''
  return { getUserDataDir: () => dir, setUserDataDir: (next) => { dir = next } }
})

vi.mock('electron', () => ({
  app: { getPath: () => getUserDataDir() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`CIPHER(${plain})`, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').replace(/^CIPHER\((.*)\)$/, '$1'),
  },
}))

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

describe('planLaunchWatchers — which watchers start when the app launches', () => {
  it('starts every connection with a present folder when nothing was stopped', () => {
    const plan = planLaunchWatchers(CONNECTIONS, [], folderExists)
    expect(plan.startable.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('treats a missing stopped list as nothing stopped (configs written before the list existed)', () => {
    const plan = planLaunchWatchers(CONNECTIONS, undefined, folderExists)
    expect(plan.startable.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('reports each unwatchable connection with its reason rather than dropping it', () => {
    const plan = planLaunchWatchers(CONNECTIONS, [], folderExists)
    expect(plan.blocked).toEqual([
      { id: 'c3', name: 'Archive', reason: 'folder-missing' },
      { id: 'c4', name: 'Remote',  reason: 'no-folder' },
    ])
  })

  it('does not start a connection the user stopped, even with its folder present', () => {
    const plan = planLaunchWatchers(CONNECTIONS, ['c2'], folderExists)
    expect(plan.startable.map((c) => c.id)).toEqual(['c1'])
    expect(plan.stopped).toEqual(['c2'])
  })

  it('does not report a user-stopped connection as blocked — stopping is not a failure', () => {
    const plan = planLaunchWatchers(CONNECTIONS, ['c3'], folderExists)
    expect(plan.blocked.map((b) => b.id)).toEqual(['c4'])
    expect(plan.stopped).toEqual(['c3'])
  })

  it('ignores stopped ids that no longer match any connection', () => {
    const plan = planLaunchWatchers(CONNECTIONS, ['deleted-long-ago'], folderExists)
    expect(plan.startable.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(plan.stopped).toEqual([])
  })

  it('treats a folder check that throws as a missing folder', () => {
    const plan = planLaunchWatchers(
      [{ id: 'c1', name: 'Atlas', localFolder: 'C:\\locked' }],
      [],
      () => { throw new Error('EACCES') },
    )
    expect(plan.startable).toEqual([])
    expect(plan.blocked).toEqual([{ id: 'c1', name: 'Atlas', reason: 'folder-missing' }])
  })

  it('handles a config with no connections', () => {
    expect(planLaunchWatchers(undefined, [], folderExists)).toEqual({ startable: [], blocked: [], stopped: [] })
  })
})

describe('withWatchIntent — recording Start and Stop', () => {
  it('adds a connection to the stopped list when the user stops it', () => {
    expect(withWatchIntent([], 'c1', false)).toEqual(['c1'])
  })

  it('removes a connection from the stopped list when the user starts it', () => {
    expect(withWatchIntent(['c1', 'c2'], 'c1', true)).toEqual(['c2'])
  })

  it('never lists the same connection twice', () => {
    expect(withWatchIntent(['c1'], 'c1', false)).toEqual(['c1'])
  })

  it('accepts a missing list', () => {
    expect(withWatchIntent(undefined, 'c1', false)).toEqual(['c1'])
    expect(withWatchIntent(undefined, 'c1', true)).toEqual([])
  })

  it('does not mutate the list it was given', () => {
    const before = ['c1']
    withWatchIntent(before, 'c2', false)
    withWatchIntent(before, 'c1', true)
    expect(before).toEqual(['c1'])
  })

  it('round-trips through intent: stop then start leaves the connection auto-starting', () => {
    const stopped = withWatchIntent(withWatchIntent([], 'c2', false), 'c2', true)
    const plan = planLaunchWatchers(CONNECTIONS, stopped, folderExists)
    expect(plan.startable.map((c) => c.id)).toEqual(['c1', 'c2'])
  })
})

describe('stoppedWatchers in config — owned by main, survives a restart', () => {
  let tmpUserData

  beforeEach(() => {
    tmpUserData = mkdtempSync(join(tmpdir(), 'winraid-watch-intent-test-'))
    setUserDataDir(tmpUserData)
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(tmpUserData, { recursive: true, force: true })
  })

  it('defaults to an empty list', async () => {
    const { getConfig } = await import('./config.js')
    expect(getConfig('stoppedWatchers')).toEqual([])
  })

  it('reads back what was saved after a fresh module load (an app restart)', async () => {
    const first = await import('./config.js')
    first.setConfig('stoppedWatchers', ['c2'])
    vi.resetModules()
    const second = await import('./config.js')
    expect(second.getConfig('stoppedWatchers')).toEqual(['c2'])
  })

  it('is not writable by the renderer — only main records Start and Stop', () => {
    expect(CONFIG_SET_ALLOWLIST).not.toContain('stoppedWatchers')
  })
})
