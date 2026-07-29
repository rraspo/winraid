// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }))
vi.mock('fs/promises', () => ({ readFile: readFileMock }))

// Minimal ssh2 Client double: records the connect() config and lets a test
// drive the 'ready'/'error' lifecycle. lastClient.current is the most recently
// constructed instance.
const { ClientMock, lastClient } = vi.hoisted(() => {
  const lastClient = { current: null }
  const ClientMock = vi.fn(function () {
    const handlers = {}
    const client = {
      connectConfig: null,
      ended: false,
      on(event, cb) { handlers[event] = cb; return client },
      connect(config) { client.connectConfig = config; return client },
      end() { client.ended = true },
      emit(event, ...args) { handlers[event]?.(...args) },
    }
    lastClient.current = client
    return client
  })
  return { ClientMock, lastClient }
})
vi.mock('ssh2', () => ({ Client: ClientMock }))

const { getPinnedMock, pinMock } = vi.hoisted(() => ({ getPinnedMock: vi.fn(), pinMock: vi.fn() }))
vi.mock('./known-hosts.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getPinnedHostKey: getPinnedMock,
  pinHostKey: pinMock,
}))
vi.mock('./config.js', () => ({ getConfig: vi.fn(), setConfig: vi.fn() }))

import { expandKeyPath, getConnConfig, createSshConnection, hostKeyFingerprint } from './ssh-connection.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.clearAllMocks()
  lastClient.current = null
  getPinnedMock.mockReturnValue(undefined)
})

describe('expandKeyPath', () => {
  it('expands a leading ~/ to the home directory', () => {
    expect(expandKeyPath('~/.ssh/id_ed25519')).toBe(join(homedir(), '.ssh/id_ed25519'))
  })

  it('strips a leading backslash after ~ (Windows-style)', () => {
    expect(expandKeyPath('~\\keys\\id')).toBe(join(homedir(), 'keys\\id'))
  })

  it('expands a bare ~ to the home directory', () => {
    expect(expandKeyPath('~')).toBe(join(homedir(), ''))
  })

  it('leaves an absolute path untouched', () => {
    expect(expandKeyPath('/etc/ssh/key')).toBe('/etc/ssh/key')
  })

  it('passes through empty / nullish values', () => {
    expect(expandKeyPath('')).toBe('')
    expect(expandKeyPath(undefined)).toBe(undefined)
  })
})

describe('getConnConfig', () => {
  it('builds a password-auth config, trimming the password and defaulting the port', async () => {
    const config = await getConnConfig({ host: 'nas.local', username: 'backup', password: '  secret  ' })
    expect(config).toMatchObject({
      host: 'nas.local',
      port: 22,
      username: 'backup',
      password: 'secret',
      readyTimeout: 10_000,
    })
    expect(config.privateKey).toBeUndefined()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('reads and attaches the private key, tilde-expanded, when keyPath is set', async () => {
    readFileMock.mockResolvedValueOnce(Buffer.from('PRIVATE KEY'))
    const config = await getConnConfig({ host: 'nas.local', username: 'backup', keyPath: '~/.ssh/id' }, { readyTimeout: 15_000 })
    expect(readFileMock).toHaveBeenCalledWith(join(homedir(), '.ssh/id'))
    expect(config.privateKey).toEqual(Buffer.from('PRIVATE KEY'))
    expect(config.readyTimeout).toBe(15_000)
  })

  it('honours a password override (used by the pool for decrypted passwords)', async () => {
    const config = await getConnConfig({ host: 'h', username: 'u', password: 'enc:xxx' }, { password: 'decrypted' })
    expect(config.password).toBe('decrypted')
  })

  it('coerces an empty / whitespace password to undefined', async () => {
    const config = await getConnConfig({ host: 'h', username: 'u', password: '   ' })
    expect(config.password).toBeUndefined()
  })

  it('throws a tagged error when the key file cannot be read', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT: no such file'))
    await expect(getConnConfig({ host: 'h', username: 'u', keyPath: '~/missing' }))
      .rejects.toMatchObject({ code: 'KEY_READ_FAILED', message: 'Cannot read key file: ENOENT: no such file' })
  })
})

describe('createSshConnection', () => {
  it('resolves with the connected client on ready and passes the built config to connect()', async () => {
    const promise = createSshConnection({ host: 'nas.local', username: 'u', password: 'p' }, { readyTimeout: 10_000 })
    await flush()
    expect(lastClient.current.connectConfig).toMatchObject({ host: 'nas.local', username: 'u', password: 'p', readyTimeout: 10_000 })
    lastClient.current.emit('ready')
    await expect(promise).resolves.toBe(lastClient.current)
  })

  it('rejects when the client emits error', async () => {
    const promise = createSshConnection({ host: 'nas.local', username: 'u', password: 'p' })
    await flush()
    lastClient.current.emit('error', new Error('ECONNREFUSED'))
    await expect(promise).rejects.toThrow('ECONNREFUSED')
  })

  it('propagates the tagged key-read error without constructing a client', async () => {
    readFileMock.mockRejectedValueOnce(new Error('EACCES'))
    await expect(createSshConnection({ host: 'h', username: 'u', keyPath: '~/k' }))
      .rejects.toMatchObject({ code: 'KEY_READ_FAILED' })
    expect(ClientMock).not.toHaveBeenCalled()
  })
})

// WR-07: every connect used to accept any host key, so anything on the LAN
// could answer as the NAS and collect the credentials.
describe('host key verification', () => {
  const cfg = { host: 'nas.local', port: 22, username: 'u', password: 'p' }
  const HOST_KEY = Buffer.from('ssh-ed25519 AAAA-the-real-nas')
  const OTHER_KEY = Buffer.from('ssh-ed25519 AAAA-an-impostor')

  async function connectWith(key, connCfg = cfg) {
    const promise = createSshConnection(connCfg)
    await flush()
    const accepted = lastClient.current.connectConfig.hostVerifier(key)
    return { promise, accepted }
  }

  it('formats a fingerprint the way OpenSSH prints one', () => {
    const fp = hostKeyFingerprint(HOST_KEY)
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)   // base64, padding stripped
    expect(fp).not.toMatch(/=$/)
    expect(hostKeyFingerprint(HOST_KEY)).toBe(fp)   // stable
    expect(hostKeyFingerprint(OTHER_KEY)).not.toBe(fp)
  })

  it('always installs a verifier — an unset one means auto-accept', async () => {
    createSshConnection(cfg)
    await flush()
    expect(typeof lastClient.current.connectConfig.hostVerifier).toBe('function')
    expect(lastClient.current.connectConfig.hostHash).toBeUndefined()  // verifier must get the raw key
  })

  it('pins the key on first connect and accepts it', async () => {
    const { accepted } = await connectWith(HOST_KEY)
    expect(accepted).toBe(true)
    expect(pinMock).toHaveBeenCalledWith('nas.local', 22, hostKeyFingerprint(HOST_KEY))
  })

  it('accepts a later connect presenting the pinned key, and does not re-pin', async () => {
    getPinnedMock.mockReturnValue(hostKeyFingerprint(HOST_KEY))
    const { accepted } = await connectWith(HOST_KEY)
    expect(accepted).toBe(true)
    expect(pinMock).not.toHaveBeenCalled()
  })

  it('rejects a different key and never overwrites the pin', async () => {
    getPinnedMock.mockReturnValue(hostKeyFingerprint(HOST_KEY))
    const { accepted } = await connectWith(OTHER_KEY)
    expect(accepted).toBe(false)
    expect(pinMock).not.toHaveBeenCalled()
  })

  it('reports a changed host key distinctly, not as a generic handshake failure', async () => {
    getPinnedMock.mockReturnValue(hostKeyFingerprint(HOST_KEY))
    const { promise } = await connectWith(OTHER_KEY)
    lastClient.current.emit('error', new Error('Handshake failed'))
    await expect(promise).rejects.toMatchObject({ code: 'HOST_KEY_CHANGED' })
    await expect(promise).rejects.toThrow(/nas\.local/)
    await expect(promise).rejects.toThrow(/host key/i)
  })

  it('leaves an unrelated connection error alone', async () => {
    const promise = createSshConnection(cfg)
    await flush()
    lastClient.current.emit('error', new Error('ECONNREFUSED'))
    await expect(promise).rejects.toThrow('ECONNREFUSED')
    await expect(promise).rejects.not.toMatchObject({ code: 'HOST_KEY_CHANGED' })
  })

  it('pins per host and port, so a different port is its own trust decision', async () => {
    await connectWith(HOST_KEY, { ...cfg, port: 2222 })
    expect(getPinnedMock).toHaveBeenCalledWith('nas.local', 2222)
    expect(pinMock).toHaveBeenCalledWith('nas.local', 2222, hostKeyFingerprint(HOST_KEY))
  })

  // The transfer worker must not write the config: setConfig persists a
  // whole per-process cache, so a write from there can clobber the main
  // process. It still has to enforce a pin that already exists.
  it('with pinning off, trusts an unpinned host without recording it', async () => {
    const promise = createSshConnection(cfg, { pinHostKeys: false })
    await flush()
    expect(lastClient.current.connectConfig.hostVerifier(HOST_KEY)).toBe(true)
    expect(pinMock).not.toHaveBeenCalled()
    lastClient.current.emit('ready')
    await promise
  })

  it('with pinning off, still rejects a key that contradicts the pin', async () => {
    getPinnedMock.mockReturnValue(hostKeyFingerprint(HOST_KEY))
    const promise = createSshConnection(cfg, { pinHostKeys: false })
    await flush()
    expect(lastClient.current.connectConfig.hostVerifier(OTHER_KEY)).toBe(false)
    lastClient.current.emit('error', new Error('Handshake failed'))
    await expect(promise).rejects.toMatchObject({ code: 'HOST_KEY_CHANGED' })
  })

  it('treats a missing port as 22 on both read and write', async () => {
    await connectWith(HOST_KEY, { host: 'nas.local', username: 'u', password: 'p' })
    expect(getPinnedMock).toHaveBeenCalledWith('nas.local', 22)
    expect(pinMock).toHaveBeenCalledWith('nas.local', 22, expect.any(String))
  })
})
