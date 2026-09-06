import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The Connections screen, the connection editor and its helper pickers are
// on the redesign: every color comes from a design token.
const CONNECTION_MODULES = [
  'src/views/ConnectionsView.module.css',
  'src/views/ConnectionView.module.css',
  'src/components/ConnectionModal.module.css',
  'src/components/RemotePathBrowser.module.css',
  'src/components/IconPicker.module.css',
]

describe('connections CSS uses design tokens only', () => {
  for (const modulePath of CONNECTION_MODULES) {
    it(`${modulePath} has no color literals`, () => {
      const literals = findColorLiterals(modulePath)
      expect(literals, `color literals in ${modulePath}: ${literals.join(', ')}`).toEqual([])
    })
  }
})
