// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// electron's safeStorage/app are not available under vitest — mock them so
// config.js can be exercised as a plain node module. vi.mock() factories are
// hoisted above imports, so any state they close over must come from
// vi.hoisted().
const { mockSafeStorage, getUserDataDir, setUserDataDir } = vi.hoisted(() => {
  let dir = ''
  return {
    mockSafeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((plain) => Buffer.from(`CIPHER(${plain})`, 'utf8')),
      decryptString: vi.fn((buf) => {
        const raw = buf.toString('utf8')
        const match = raw.match(/^CIPHER\((.*)\)$/)
        return match ? match[1] : raw
      }),
    },
    getUserDataDir: () => dir,
    setUserDataDir: (next) => { dir = next },
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => getUserDataDir() },
  safeStorage: mockSafeStorage,
}))

let tmpUserData

beforeEach(() => {
  tmpUserData = mkdtempSync(join(tmpdir(), 'winraid-config-test-'))
  setUserDataDir(tmpUserData)
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
  mockSafeStorage.encryptString.mockClear()
  mockSafeStorage.decryptString.mockClear()
  vi.resetModules()
})

afterEach(() => {
  rmSync(tmpUserData, { recursive: true, force: true })
})

function readRawConfigFile() {
  const file = join(tmpUserData, 'WinRaid', 'config.json')
  return readFileSync(file, 'utf8')
}

const CONN = {
  id: 'c1',
  name: 'nas',
  type: 'sftp',
  sftp: { host: 'nas.local', username: 'root', password: 'hunter2', keyPath: '', remotePath: '/' },
}

describe('setConfig — encryption available', () => {
  it('persists the password under the enc: prefix, never in the clear', async () => {
    const { setConfig } = await import('./config.js')
    setConfig('connections', [CONN])

    const raw = readRawConfigFile()
    expect(raw).not.toContain('hunter2')
    const onDisk = JSON.parse(raw)
    expect(onDisk.connections[0].sftp.password).toMatch(/^enc:/)
  })
})

describe('setConfig — encryption unavailable (WR-09)', () => {
  beforeEach(() => {
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false)
  })

  it('stores the plaintext value as-is, never impersonating the enc: format', async () => {
    const { setConfig } = await import('./config.js')
    setConfig('connections', [CONN])

    const onDisk = JSON.parse(readRawConfigFile())
    const persistedPassword = onDisk.connections[0].sftp.password
    // Warn-but-store: the plaintext is kept usable, and nothing on disk
    // pretends to be ciphertext.
    expect(persistedPassword).toBe('hunter2')
    expect(persistedPassword).not.toMatch(/^enc:/)
    expect(mockSafeStorage.encryptString).not.toHaveBeenCalled()
  })

  it('takes the warning path: setConfig reports the fallback so callers can surface it', async () => {
    const { setConfig } = await import('./config.js')
    const result = setConfig('connections', [CONN])

    expect(result?.warning).toBe('encryption-unavailable')
  })

  it('round-trips: the password is usable again after an app restart', async () => {
    const { setConfig } = await import('./config.js')
    setConfig('connections', [CONN])

    // Simulate a fresh app launch: reload the module so its in-memory cache
    // is gone and everything is re-read from the persisted file.
    vi.resetModules()
    const { getConfig } = await import('./config.js')

    const reloaded = getConfig('connections')[0]
    expect(reloaded.sftp.password).toBe('hunter2')
    // The plain value must never be routed through decryptString.
    expect(mockSafeStorage.decryptString).not.toHaveBeenCalled()
  })

  it('does not report a warning when no secret is being persisted', async () => {
    const { setConfig } = await import('./config.js')
    const result = setConfig('activeConnectionId', 'c1')

    expect(result?.warning).toBeFalsy()
  })
})
