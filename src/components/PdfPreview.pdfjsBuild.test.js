import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// pdf.js fingerprints every document with Uint8Array.prototype.toHex(), which
// this Electron's Chromium does not implement — the default build dies with
// "toHex is not a function" on any PDF. Only the legacy build polyfills it.
//
// These guard the two ways that regresses: someone switching the import back
// to the default build, or a pdfjs upgrade dropping the polyfill from legacy.
// Both fail silently at runtime and only on a real PDF, so they are worth
// pinning here. Delete once Electron's Chromium has the method natively.
describe('pdfjs build selection', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'PdfPreview.jsx'), 'utf8')

  it('loads the worker from the legacy build', () => {
    expect(source).toContain('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
    expect(source).not.toMatch(/from 'pdfjs-dist\/build\//)
  })

  it('loads the library from the legacy build, matching the worker', () => {
    expect(source).toContain("import('pdfjs-dist/legacy/build/pdf.mjs')")
    expect(source).not.toMatch(/import\('pdfjs-dist'\)/)
  })

  it('still gets a toHex polyfill from the legacy worker it points at', () => {
    const worker = readFileSync(
      resolve(import.meta.dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
      'utf8',
    )
    expect(worker).toContain('toHex')
    // core-js installs the method rather than only calling it.
    expect(worker).toMatch(/toHex\s*[:(]/)
  })
})
