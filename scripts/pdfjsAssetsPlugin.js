import { readdirSync, readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join, resolve, sep } from 'path'

// pdf.js loads fonts, CMaps, wasm image decoders and ICC profiles at run time
// from URLs, not through the bundler, so they have to exist as plain files
// next to the page. Emitted under pdfjs/ in the build; served from the same
// path by the dev server.
export const PDFJS_ASSET_DIRS = ['standard_fonts', 'cmaps', 'wasm', 'iccs']

const PREFIX = '/pdfjs/'

function pdfjsRoot() {
  return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
}

const MIME = { '.wasm': 'application/wasm', '.js': 'text/javascript' }

export function pdfjsAssets() {
  const root = pdfjsRoot()
  return {
    name: 'winraid-pdfjs-assets',

    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        for (const name of readdirSync(join(root, dir))) {
          if (name.startsWith('LICENSE')) continue
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${name}`,
            source: readFileSync(join(root, dir, name)),
          })
        }
      }
    },

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? '').split('?')[0]
        if (!url.startsWith(PREFIX)) return next()
        const relative = decodeURIComponent(url.slice(PREFIX.length))
        const target = resolve(root, relative)
        const allowed = PDFJS_ASSET_DIRS.some((dir) => target.startsWith(join(root, dir) + sep))
        if (!allowed || !existsSync(target)) {
          response.statusCode = 404
          response.end('Not found')
          return undefined
        }
        const extension = target.slice(target.lastIndexOf('.'))
        response.setHeader('Content-Type', MIME[extension] ?? 'application/octet-stream')
        response.end(readFileSync(target))
        return undefined
      })
    },
  }
}
