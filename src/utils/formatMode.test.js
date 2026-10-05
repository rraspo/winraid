import { describe, it, expect } from 'vitest'
import { formatMode } from './formatMode'

describe('formatMode', () => {
  it('renders the classic rwx triplet', () => {
    expect(formatMode('755')).toBe('rwxr-xr-x')
    expect(formatMode('644')).toBe('rw-r--r--')
    expect(formatMode('600')).toBe('rw-------')
  })

  it('uses only the last three digits when a special-bits digit leads', () => {
    expect(formatMode('0755')).toBe('rwxr-xr-x')
  })

  it('returns null for input that is not an octal mode', () => {
    expect(formatMode('abc')).toBeNull()
    expect(formatMode('')).toBeNull()
    expect(formatMode(undefined)).toBeNull()
  })
})
