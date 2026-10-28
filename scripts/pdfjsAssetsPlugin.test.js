// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { pdfjsAssets, PDFJS_ASSET_DIRS } from './pdfjsAssetsPlugin.js'

describe('pdfjsAssets build plugin', () => {
  it('emits the standard fonts, cmaps, wasm decoders and ICC profile under pdfjs/', () => {
    const emitted = []
    const plugin = pdfjsAssets()
    plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) })
    const names = emitted.map((file) => file.fileName)

    expect(emitted.every((file) => file.type === 'asset')).toBe(true)
    expect(names).toContain('pdfjs/standard_fonts/LiberationSans-Regular.ttf')
    expect(names).toContain('pdfjs/cmaps/UniJIS-UTF16-H.bcmap')
    expect(names).toContain('pdfjs/wasm/openjpeg.wasm')
    expect(names).toContain('pdfjs/wasm/jbig2.wasm')
    expect(names).toContain('pdfjs/wasm/qcms_bg.wasm')
    expect(names.some((name) => name.startsWith('pdfjs/iccs/'))).toBe(true)
    expect(PDFJS_ASSET_DIRS).toEqual(['standard_fonts', 'cmaps', 'wasm', 'iccs'])
  })

  it('ships the third-party licenses next to the binaries they cover', () => {
    const emitted = []
    pdfjsAssets().generateBundle.call({ emitFile: (file) => emitted.push(file) })
    const names = emitted.map((file) => file.fileName)
    expect(names).toContain('pdfjs/wasm/LICENSE_OPENJPEG')
    expect(names).toContain('pdfjs/wasm/LICENSE_JBIG2')
    expect(names).toContain('pdfjs/wasm/LICENSE_QCMS')
  })

  it('answers dev-server requests for /pdfjs/ files and passes everything else on', () => {
    const plugin = pdfjsAssets()
    let middleware
    plugin.configureServer({ middlewares: { use: (handler) => { middleware = handler } } })

    const served = { headers: {}, setHeader(key, value) { this.headers[key] = value }, end: vi.fn() }
    const next = vi.fn()
    middleware({ url: '/pdfjs/wasm/openjpeg.wasm' }, served, next)
    expect(next).not.toHaveBeenCalled()
    expect(served.end).toHaveBeenCalledTimes(1)
    expect(served.end.mock.calls[0][0].length).toBeGreaterThan(1000)

    const other = vi.fn()
    middleware({ url: '/src/main.jsx' }, served, other)
    expect(other).toHaveBeenCalled()
  })

  it('never serves a path that escapes the asset directories', () => {
    const plugin = pdfjsAssets()
    let middleware
    plugin.configureServer({ middlewares: { use: (handler) => { middleware = handler } } })
    const served = { statusCode: 200, setHeader() {}, end: vi.fn() }
    const next = vi.fn()
    middleware({ url: '/pdfjs/wasm/../../package.json' }, served, next)
    expect(served.statusCode).toBe(404)
    expect(served.end.mock.calls[0][0]).not.toMatch(/"name"/)
  })
})
