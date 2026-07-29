// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getConfigMock, setConfigMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  setConfigMock: vi.fn(),
}))
vi.mock('./config.js', () => ({ getConfig: getConfigMock, setConfig: setConfigMock }))

import { hostKeyId, getPinnedHostKey, pinHostKey, forgetHostKey } from './known-hosts.js'

beforeEach(() => {
  vi.clearAllMocks()
  getConfigMock.mockReturnValue(undefined)
})

describe('hostKeyId', () => {
  it('keys a pin by host and port, so two connections to one NAS share it', () => {
    expect(hostKeyId('nas.local', 2222)).toBe('nas.local:2222')
  })

  it('defaults the port to 22, matching the connect config', () => {
    expect(hostKeyId('nas.local')).toBe('nas.local:22')
    expect(hostKeyId('nas.local', 0)).toBe('nas.local:22')
  })
})

describe('the pin store', () => {
  it('reads nothing for a host that has never been seen', () => {
    expect(getPinnedHostKey('nas.local', 22)).toBeUndefined()
  })

  it('reads back a stored fingerprint', () => {
    getConfigMock.mockReturnValue({ 'nas.local:22': 'SHA256:abc' })
    expect(getPinnedHostKey('nas.local', 22)).toBe('SHA256:abc')
  })

  it('writes a pin without disturbing the other hosts', () => {
    getConfigMock.mockReturnValue({ 'other:22': 'SHA256:zzz' })
    pinHostKey('nas.local', 22, 'SHA256:abc')
    expect(setConfigMock).toHaveBeenCalledWith('knownHostKeys', {
      'other:22': 'SHA256:zzz',
      'nas.local:22': 'SHA256:abc',
    })
  })

  it('writes a pin when the store does not exist yet', () => {
    pinHostKey('nas.local', 22, 'SHA256:abc')
    expect(setConfigMock).toHaveBeenCalledWith('knownHostKeys', { 'nas.local:22': 'SHA256:abc' })
  })

  it('forgets one host and leaves the rest pinned', () => {
    getConfigMock.mockReturnValue({ 'nas.local:22': 'SHA256:abc', 'other:22': 'SHA256:zzz' })
    forgetHostKey('nas.local', 22)
    expect(setConfigMock).toHaveBeenCalledWith('knownHostKeys', { 'other:22': 'SHA256:zzz' })
  })

  it('forgetting an unpinned host is a no-op rather than an error', () => {
    getConfigMock.mockReturnValue({ 'other:22': 'SHA256:zzz' })
    expect(() => forgetHostKey('nas.local', 22)).not.toThrow()
  })
})
