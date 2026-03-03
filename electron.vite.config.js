import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// Derive __dirname for ESM config files
const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Main process — Node.js / Electron
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // Absolute path prevents externalizeDepsPlugin from confusing
        // our ./electron/ folder with the 'electron' npm package.
        input: {
          index: resolve(__dirname, 'electron/main.js'),
        },
      },
    },
  },

  // Preload — sandboxed bridge between main and renderer
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.js'),
        },
      },
    },
  },

  // Renderer — React/Vite SPA
  renderer: {
    root: __dirname,
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
  },
})
