// Standalone Vite config for running the React renderer alone, outside
// Electron, in a plain browser — see the "Preview the renderer in a
// browser" section of the README. Mirrors the renderer section of
// electron.vite.config.js (same root, alias, React plugin) and adds:
//   - a fixed dev-server address so scripts/preview/shoot.mjs can find it
//   - a plugin that injects the preview bridge (window.winraid stand-in)
//     before /src/main.jsx, so it installs before React mounts
//   - a relaxed CSP: the renderer's production CSP only allows the
//     nas-stream: scheme for images, which fixture data URLs are not
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')

function previewBridgePlugin() {
  return {
    name: 'winraid-preview-bridge',
    transformIndexHtml(html) {
      return html
        // The production CSP has no allowance for fixture image data: URLs
        // beyond what it already grants nas-stream: — drop it for preview.
        .replace(/<meta[\s\S]*?Content-Security-Policy[\s\S]*?\/>/, '')
        .replace(
          '<script type="module" src="/src/main.jsx"></script>',
          '<script type="module" src="/scripts/preview/bridge.js"></script>\n'
          + '    <script type="module" src="/src/main.jsx"></script>',
        )
    },
  }
}

export default defineConfig({
  root: repoRoot,
  plugins: [previewBridgePlugin(), react()],
  resolve: {
    alias: {
      '@': resolve(repoRoot, 'src'),
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
})
