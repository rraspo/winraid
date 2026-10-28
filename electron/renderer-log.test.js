// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { formatRendererLog } from './renderer-log.js'

describe('formatRendererLog', () => {
  it('formats a scoped renderer entry for the log file', () => {
    expect(formatRendererLog({ scope: 'pdf-preview', level: 'error', message: 'boom', details: { name: 'InvalidPDFException', path: '/docs/a.pdf' } }))
      .toEqual({ level: 'error', message: '[pdf-preview] boom (name=InvalidPDFException, path=/docs/a.pdf)' })
  })

  it('rejects malformed entries instead of logging them', () => {
    expect(formatRendererLog(null)).toBeNull()
    expect(formatRendererLog({ scope: 'x' })).toBeNull()
    expect(formatRendererLog({ scope: 5, message: 'm' })).toBeNull()
  })

  it('coerces unknown levels to error and bounds the length', () => {
    const entry = formatRendererLog({ scope: 's', level: 'fatal', message: 'x'.repeat(5000) })
    expect(entry.level).toBe('error')
    expect(entry.message.length).toBeLessThan(1100)
  })

  it('keeps only scalar details and strips newlines so one entry stays one line', () => {
    const entry = formatRendererLog({ scope: 's', message: 'a\nb', details: { path: '/a\n/b', nested: { x: 1 } } })
    expect(entry.message).not.toMatch(/\n/)
    expect(entry.message).not.toContain('nested')
  })
})
