import { describe, it, expect, beforeEach } from 'vitest'
import { needsLocalTrimConsent, markLocalTrimAcked, isLocalTrimAcked, resetLocalTrimAck } from './localTrimConsent'

beforeEach(() => resetLocalTrimAck())

describe('needsLocalTrimConsent', () => {
  it('never asks when the NAS does the work', () => {
    expect(needsLocalTrimConsent({ mode: 'server', acked: false })).toBe(false)
  })

  it('asks before the first local run on an ffmpeg found on PATH', () => {
    expect(needsLocalTrimConsent({ mode: 'local', source: 'path', acked: false })).toBe(true)
  })

  it('stops asking once the user has agreed', () => {
    expect(needsLocalTrimConsent({ mode: 'local', source: 'path', acked: true })).toBe(false)
  })

  // Downloading the binary through this very prompt, or pointing the app at
  // one by hand, is the consent — re-asking on the next file is the bug.
  it('does not ask for an ffmpeg the user installed deliberately', () => {
    expect(needsLocalTrimConsent({ mode: 'local', source: 'downloaded', acked: false })).toBe(false)
    expect(needsLocalTrimConsent({ mode: 'local', source: 'custom', acked: false })).toBe(false)
  })
})

describe('session acknowledgement', () => {
  it('survives being read back after it is set', () => {
    expect(isLocalTrimAcked()).toBe(false)
    markLocalTrimAcked()
    expect(isLocalTrimAcked()).toBe(true)
  })

  // The overlay remounts per opened file; a per-component ref reset every time
  // and re-prompted, which is what this module exists to outlive.
  it('is module state, so it outlives any one component', () => {
    markLocalTrimAcked()
    expect(needsLocalTrimConsent({ mode: 'local', source: 'path', acked: isLocalTrimAcked() })).toBe(false)
  })
})
