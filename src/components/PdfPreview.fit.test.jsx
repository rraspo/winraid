import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: () => Promise.resolve({
        getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      }),
      destroy: () => {},
    }),
  }),
}))

import PdfPreview from './PdfPreview'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })))
})
afterEach(() => vi.unstubAllGlobals())

describe('PdfPreview — fit controls', () => {
  it('offers Fit width and Fit page, with Fit width selected by default', async () => {
    render(<PdfPreview src="nas-stream://conn/doc.pdf" />)
    const fitWidth = await screen.findByRole('radio', { name: /fit width/i })
    const fitPage  = screen.getByRole('radio', { name: /fit page/i })
    expect(fitWidth).toHaveAttribute('aria-checked', 'true')
    expect(fitPage).toHaveAttribute('aria-checked', 'false')
  })

  it('switches to Fit page when it is clicked', async () => {
    render(<PdfPreview src="nas-stream://conn/doc.pdf" />)
    fireEvent.click(await screen.findByRole('radio', { name: /fit page/i }))
    expect(screen.getByRole('radio', { name: /fit page/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /fit width/i })).toHaveAttribute('aria-checked', 'false')
  })
})
