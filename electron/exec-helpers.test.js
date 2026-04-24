// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { execWithTimeout } from './exec-helpers.js'

function makeStream({ exitCode = 0, stdout = '', stderr = '', hangMs = null } = {}) {
  const listeners = {}
  const stream = {
    on: vi.fn((event, cb) => { listeners[event] = cb; return stream }),
    resume: vi.fn(),
    stderr: {
      on: vi.fn((event, cb) => { listeners[`stderr:${event}`] = cb; return stream }),
    },
    destroy: vi.fn(() => {
      listeners['close']?.(null)
    }),
  }
  if (!hangMs) {
    setTimeout(() => {
      listeners['data']?.(Buffer.from(stdout))
      listeners[`stderr:data`]?.(Buffer.from(stderr))
      listeners['close']?.(exitCode)
    }, 0)
  }
  return stream
}

function makeClient(stream) {
  return {
    exec: vi.fn((cmd, cb) => cb(null, stream)),
  }
}

describe('execWithTimeout', () => {
  it('resolves with stdout on exit code 0', async () => {
    const stream = makeStream({ stdout: 'hello\n' })
    const client = makeClient(stream)
    const result = await execWithTimeout(client, 'echo hello', 5000)
    expect(result).toEqual({ code: 0, stdout: 'hello\n', stderr: '' })
  })

  it('resolves with non-zero exit code', async () => {
    const stream = makeStream({ exitCode: 1, stderr: 'not found' })
    const client = makeClient(stream)
    const result = await execWithTimeout(client, 'false', 5000)
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('not found')
  })

  it('rejects with timeout error when stream hangs', async () => {
    vi.useFakeTimers()
    const stream = { on: vi.fn(() => stream), resume: vi.fn(), stderr: { on: vi.fn(() => stream) }, destroy: vi.fn() }
    const client = { exec: vi.fn((cmd, cb) => cb(null, stream)) }
    const p = execWithTimeout(client, 'sleep 999', 1000)
    vi.advanceTimersByTime(1001)
    await expect(p).rejects.toThrow('timed out')
    vi.useRealTimers()
  })

  it('does not resolve after timeout even if close fires late', async () => {
    vi.useFakeTimers()
    const listeners = {}
    const stream = {
      on: vi.fn((event, cb) => { listeners[event] = cb; return stream }),
      resume: vi.fn(),
      stderr: { on: vi.fn(() => stream) },
      destroy: vi.fn(() => { listeners['close']?.(0) }),
    }
    const client = { exec: vi.fn((cmd, cb) => cb(null, stream)) }
    const p = execWithTimeout(client, 'sleep 999', 1000)
    vi.advanceTimersByTime(1001)
    // destroy fires close(0) immediately — settled guard must reject, not resolve
    await expect(p).rejects.toThrow('timed out')
    vi.useRealTimers()
  })

  it('rejects when exec itself errors', async () => {
    const client = { exec: vi.fn((cmd, cb) => cb(new Error('exec failed'))) }
    await expect(execWithTimeout(client, 'cmd', 5000)).rejects.toThrow('exec failed')
  })
})
