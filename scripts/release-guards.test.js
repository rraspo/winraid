// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { assertReleasable, assertQualityGate, assertWhatsNewCurrent } from './release-guards.js'

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

describe('assertQualityGate', () => {
  it('runs lint then test, in order, when both succeed', () => {
    const calls = []
    const run = vi.fn((cmd) => { calls.push(cmd) })
    assertQualityGate({ run })
    expect(calls).toEqual(['npm run lint', 'npm test'])
  })

  it('throws and never runs tests when lint fails (fail closed)', () => {
    const run = vi.fn((cmd) => {
      if (cmd === 'npm run lint') throw new Error('eslint: 2 errors')
    })
    expect(() => assertQualityGate({ run })).toThrow(/eslint/)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('npm run lint')
  })

  it('throws when lint passes but tests fail', () => {
    const run = vi.fn((cmd) => {
      if (cmd === 'npm test') throw new Error('vitest: 1 failed')
    })
    expect(() => assertQualityGate({ run })).toThrow(/vitest/)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('requires a run function to be provided', () => {
    expect(() => assertQualityGate({})).toThrow(/run/)
  })
})

describe('assertWhatsNewCurrent', () => {
  const highlights = [{ icon: 'History', title: 'Activity', body: 'Past transfers stay listed.' }]

  it('throws when What\'s New was written for an earlier version', () => {
    expect(() => assertWhatsNewCurrent({ whatsNew: { version: '3.0.0', highlights }, releaseVersion: '3.1.0' }))
      .toThrow(/3\.0\.0.*3\.1\.0/)
  })

  it('throws when What\'s New has no highlights', () => {
    expect(() => assertWhatsNewCurrent({ whatsNew: { version: '3.1.0', highlights: [] }, releaseVersion: '3.1.0' }))
      .toThrow(/highlights/i)
  })

  it('passes when the version matches and highlights are present', () => {
    expect(() => assertWhatsNewCurrent({ whatsNew: { version: '3.1.0', highlights }, releaseVersion: '3.1.0' }))
      .not.toThrow()
  })
})
