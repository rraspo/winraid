import { describe, it, expect } from 'vitest'
import { describePdfError } from './pdfError'

describe('describePdfError', () => {
  it('names password-protected documents', () => {
    const error = Object.assign(new Error('No password given'), { name: 'PasswordException' })
    expect(describePdfError(error)).toBe('This PDF is password-protected')
  })

  it('keeps pdf.js detail for invalid files', () => {
    const error = Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' })
    expect(describePdfError(error)).toBe('This PDF could not be read: Invalid PDF structure.')
  })

  it('falls back to the message, then to a generic line', () => {
    expect(describePdfError(new Error('Failed to fetch PDF (HTTP 404)'))).toBe('Failed to fetch PDF (HTTP 404)')
    expect(describePdfError(null)).toBe('Failed to load PDF')
  })
})
