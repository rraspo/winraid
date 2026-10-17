import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const getDocument = vi.fn()
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...args) => getDocument(...args),
}))

import PdfPreview from './PdfPreview'

let logWrite
beforeEach(() => {
  logWrite = vi.fn()
  window.winraid = { log: { write: logWrite } }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })))
})
afterEach(() => { vi.unstubAllGlobals(); delete window.winraid; getDocument.mockReset() })

function failWith(name, message) {
  getDocument.mockReturnValue({ promise: Promise.reject(Object.assign(new Error(message), { name })) })
}

describe('PdfPreview — failures', () => {
  it('says so when the PDF is password-protected', async () => {
    failWith('PasswordException', 'No password given')
    render(<PdfPreview src="nas-stream://conn/docs/a.pdf" />)
    expect(await screen.findByText('This PDF is password-protected')).toBeInTheDocument()
  })

  it('shows pdf.js detail for an invalid PDF and logs the error with the remote path, not content', async () => {
    failWith('InvalidPDFException', 'Invalid PDF structure.')
    render(<PdfPreview src="nas-stream://conn/docs/my%20file%231.pdf?v=5" remotePath="/docs/my file#1.pdf" />)
    expect(await screen.findByText('This PDF could not be read: Invalid PDF structure.')).toBeInTheDocument()
    expect(logWrite).toHaveBeenCalledWith({
      scope: 'pdf-preview',
      level: 'error',
      message: 'Invalid PDF structure.',
      details: { name: 'InvalidPDFException', path: '/docs/my file#1.pdf' },
    })
  })

  it('logs and shows an HTTP failure from the stream', async () => {
    fetch.mockResolvedValue({ ok: false, status: 404 })
    render(<PdfPreview src="nas-stream://conn/a.pdf" remotePath="/a.pdf" />)
    expect(await screen.findByText('Failed to fetch PDF (HTTP 404)')).toBeInTheDocument()
    expect(logWrite).toHaveBeenCalled()
  })

  it('still shows the error when the bridge has no log method', async () => {
    window.winraid = {}
    failWith('InvalidPDFException', 'bad')
    render(<PdfPreview src="nas-stream://conn/a.pdf" remotePath="/a.pdf" />)
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument()
  })

  it('opens documents with the bundled font, cmap and wasm assets', async () => {
    failWith('InvalidPDFException', 'x')
    render(<PdfPreview src="nas-stream://conn/a.pdf" remotePath="/a.pdf" />)
    await screen.findByText(/could not be read/)
    const params = getDocument.mock.calls[0][0]
    expect(params.standardFontDataUrl).toMatch(/pdfjs\/standard_fonts\/$/)
    expect(params.cMapUrl).toMatch(/pdfjs\/cmaps\/$/)
    expect(params.cMapPacked).toBe(true)
    expect(params.wasmUrl).toMatch(/pdfjs\/wasm\/$/)
  })
})
