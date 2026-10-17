import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

import { getPdfjs, pdfAssetOptions, openPdf } from './pdfjsLoader'
import * as pdfjsMock from 'pdfjs-dist/legacy/build/pdf.mjs'

describe('pdf.js asset options', () => {
  it('points every bundled-asset option at the pdfjs/ folder beside the page', () => {
    const options = pdfAssetOptions('http://localhost:5173/index.html')
    expect(options.standardFontDataUrl).toBe('http://localhost:5173/pdfjs/standard_fonts/')
    expect(options.cMapUrl).toBe('http://localhost:5173/pdfjs/cmaps/')
    expect(options.cMapPacked).toBe(true)
    expect(options.wasmUrl).toBe('http://localhost:5173/pdfjs/wasm/')
    expect(options.iccUrl).toBe('http://localhost:5173/pdfjs/iccs/')
  })

  it('resolves relative to a packaged file:// page too', () => {
    const options = pdfAssetOptions('file:///app/resources/app.asar/out/renderer/index.html')
    expect(options.wasmUrl).toBe('file:///app/resources/app.asar/out/renderer/pdfjs/wasm/')
  })

  it('uses only option names the installed pdfjs-dist declares', () => {
    const types = readFileSync(resolve(import.meta.dirname, '../../node_modules/pdfjs-dist/types/src/display/api.d.ts'), 'utf8')
    for (const name of Object.keys(pdfAssetOptions('http://localhost/'))) {
      expect(types, name).toMatch(new RegExp(`\\b${name}\\??:`))
    }
  })

  it('the options are what getDocument receives', async () => {
    pdfjsMock.getDocument.mockReturnValue({ promise: Promise.resolve({}) })
    await openPdf({ data: new ArrayBuffer(4) })
    const params = pdfjsMock.getDocument.mock.calls[0][0]
    expect(params.data).toBeInstanceOf(ArrayBuffer)
    expect(params.standardFontDataUrl).toMatch(/pdfjs\/standard_fonts\/$/)
    expect(params.wasmUrl).toMatch(/pdfjs\/wasm\/$/)
  })

  it('shares one pdf.js import between callers', async () => {
    expect(await getPdfjs()).toBe(await getPdfjs())
  })
})
