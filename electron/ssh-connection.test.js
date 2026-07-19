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

import { expandKeyPath, getConnConfig, createSshConnection } from './ssh-connection.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.clearAllMocks()
  lastClient.current = null
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
