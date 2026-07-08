// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { assertReleasable } from './release-guards.js'

function runSilentStub({ branch = 'master', status = '' } = {}) {
  return vi.fn((cmd) => {
    if (cmd.includes('rev-parse')) return branch
    if (cmd.includes('status')) return status
    throw new Error(`unexpected command in test stub: ${cmd}`)
  })
}

describe('assertReleasable', () => {
  it('throws when the working tree is dirty', () => {
    const runSilent = runSilentStub({ branch: 'master', status: ' M scripts/release.js' })
    expect(() => assertReleasable({ runSilent })).toThrow(/dirty/i)
  })

  it('throws when the current branch is not the release branch', () => {
    const runSilent = runSilentStub({ branch: 'feat/video-trim', status: '' })
    expect(() => assertReleasable({ runSilent })).toThrow(/feat\/video-trim/)
  })

  it('passes on a clean release branch and returns the branch name', () => {
    const runSilent = runSilentStub({ branch: 'master', status: '' })
    expect(assertReleasable({ runSilent })).toBe('master')
  })

  it('honors a configurable release branch', () => {
    const runSilent = runSilentStub({ branch: 'release', status: '' })
    expect(assertReleasable({ runSilent, releaseBranch: 'release' })).toBe('release')
  })

  it('requires a runSilent function to be provided', () => {
    expect(() => assertReleasable({})).toThrow(/runSilent/)
  })
})
