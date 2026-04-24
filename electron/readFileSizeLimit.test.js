// @vitest-environment node
import { describe, it, expect } from 'vitest'

const MAX_READ_BYTES = 50 * 1024 * 1024  // 50 MB

function checkFileSizeLimit(sizeBytes) {
  if (sizeBytes > MAX_READ_BYTES) {
    return { ok: false, error: `File too large for editor (${Math.round(sizeBytes / 1024 / 1024)} MB, max 50 MB)` }
  }
  return null
}

describe('checkFileSizeLimit', () => {
  it('returns null for files under 50 MB', () => {
    expect(checkFileSizeLimit(1024)).toBeNull()
    expect(checkFileSizeLimit(50 * 1024 * 1024)).toBeNull()
  })

  it('returns error object for files over 50 MB', () => {
    const result = checkFileSizeLimit(50 * 1024 * 1024 + 1)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('too large') })
  })

  it('includes size in MB in the error message', () => {
    const result = checkFileSizeLimit(100 * 1024 * 1024)
    expect(result.error).toContain('100 MB')
  })
})
