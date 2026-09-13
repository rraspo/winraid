// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveTrashFolder, trashContextFor } from './trash-context.js'

// Contract under test — a trash operation (list/restore/purge) roots itself
// at the connection's own configured folder, never the connection's remote
// path. A connection with none configured is not an error: list treats it
// as an empty trash, while restore and purge (which need somewhere to act
// against) surface it as a plain refusal — the { noFolder: true } signal
// lets each IPC handler pick the right one.

describe('resolveTrashFolder', () => {
  it('accepts a configured folder', () => {
    expect(resolveTrashFolder('/mnt/user/media')).toBe('/mnt/user/media')
  })

  it('treats missing, blank, or whitespace-only as unconfigured', () => {
    expect(resolveTrashFolder(undefined)).toBeNull()
    expect(resolveTrashFolder(null)).toBeNull()
    expect(resolveTrashFolder('')).toBeNull()
    expect(resolveTrashFolder('   ')).toBeNull()
  })
})

describe('trashContextFor', () => {
  const deps = { sftp: {} }

  it('passes through an error resolving the connection, ignoring the folder', () => {
    expect(trashContextFor({ error: 'Connection unavailable' }, '/mnt/user/media'))
      .toEqual({ error: 'Connection unavailable' })
  })

  it('signals no folder rather than erroring when the connection has none configured', () => {
    expect(trashContextFor({ deps }, null)).toEqual({ noFolder: true })
  })

  it('roots the operation at the configured folder', () => {
    expect(trashContextFor({ deps }, '/mnt/user/media')).toEqual({ root: '/mnt/user/media', deps })
  })
})
