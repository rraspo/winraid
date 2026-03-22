import { defineConfig } from '@playwright/experimental-ct-react'
import { resolve } from 'path'

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.layout.test.jsx',
  timeout: 15000,
  use: {
    ctPort: 3101,
    ctViteConfig: {
      resolve: {
        alias: { '@': resolve(import.meta.dirname, 'src') },
      },
    },
  },
})
