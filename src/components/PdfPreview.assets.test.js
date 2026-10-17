import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const read = (relative) => readFileSync(resolve(import.meta.dirname, '../..', relative), 'utf8')

// pdf.js fetches its fonts/cmaps/wasm at run time, so the renderer build must
// ship them and the packaged CSP must let the worker run the wasm decoders.
describe('pdf.js assets in the build', () => {
  it('registers the asset plugin in the renderer build', () => {
    const config = read('electron.vite.config.js')
    expect(config).toContain('pdfjsAssets')
    expect(config).toMatch(/renderer:[\s\S]*plugins:\s*\[react\(\),\s*pdfjsAssets\(\)\]/)
  })

  it('allows wasm compilation in the packaged CSP', () => {
    const main = read('electron/main.js')
    expect(main).toMatch(/"script-src 'self' 'wasm-unsafe-eval'; "/)
  })
})
