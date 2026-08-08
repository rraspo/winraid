import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    include: ['src/**/*.test.{js,jsx}', 'electron/**/*.test.js', 'scripts/**/*.test.js'],
    exclude: ['src/**/*.layout.test.*', 'node_modules'],
    // Cap the worker pool instead of letting vitest size it from the
    // machine's full core count.
    maxWorkers: 4,
    minWorkers: 1,
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
  },
})
