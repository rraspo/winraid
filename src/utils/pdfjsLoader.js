import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// The legacy build, not the default one: pdf.js calls
// Uint8Array.prototype.toHex() while fingerprinting a document, and this
// Electron's Chromium does not implement it yet — opening any PDF died with
// "toHex is not a function". Only the legacy build carries the polyfill, and
// it has to be legacy on both sides, since the failing call happens in the
// worker where a polyfill loaded here would never reach it. Revisit once
// Electron ships a Chromium new enough to have the method natively.
let _pdfjsPromise = null
export function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })
  }
  return _pdfjsPromise
}

// Without these pdf.js falls back to missing glyphs for non-embedded fonts and
// cannot decode JPX/JBIG2 images or ICC colour. The files are copied into the
// build under pdfjs/ (see scripts/pdfjsAssetsPlugin.js).
export function pdfAssetOptions(baseUrl = document.baseURI) {
  const folder = (name) => new URL(`pdfjs/${name}/`, baseUrl).href
  return {
    standardFontDataUrl: folder('standard_fonts'),
    cMapUrl: folder('cmaps'),
    cMapPacked: true,
    wasmUrl: folder('wasm'),
    iccUrl: folder('iccs'),
    // A packaged page is file://, which the worker cannot fetch from; the
    // main thread loads the assets and hands them over.
    useWorkerFetch: false,
  }
}

export async function openPdf(source, extraOptions = {}) {
  const pdfjs = await getPdfjs()
  return pdfjs.getDocument({ ...source, ...pdfAssetOptions(), ...extraOptions })
}
