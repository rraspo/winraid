import js from '@eslint/js'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  { ignores: ['node_modules', 'out', 'dist', 'release'] },

  // Electron main process + helpers
  {
    files: ['electron/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },

  // Renderer preview harness — Node build/shoot scripts plus a browser
  // bridge script, so both global sets apply. Scoped to scripts/preview
  // rather than all of scripts/ so pre-existing release/clean scripts (never
  // linted before, not part of this harness) aren't newly swept in here.
  {
    files: ['scripts/preview/**/*.{js,mjs}'],
    ...js.configs.recommended,
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },

  // React renderer
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      // Classic react-hooks rules only. The v7 `recommended` preset adds the
      // React Compiler rule set (purity, immutability, …) which this codebase
      // does not yet satisfy — adopting it is a separate, deliberate effort.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',  // not needed with React 17+
      'react/prop-types': 'off',           // project does not use PropTypes
    },
  },
]
