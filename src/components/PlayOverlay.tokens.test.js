import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The Play wall is on the redesign: every color comes from a design token.
describe('Play wall CSS uses design tokens only', () => {
  for (const modulePath of ['src/components/PlayOverlay.module.css', 'src/components/play/PlayWall.module.css']) {
    it(`${modulePath} has no color literals`, () => {
      const literals = findColorLiterals(modulePath)
      expect(literals, `color literals in ${modulePath}: ${literals.join(', ')}`).toEqual([])
    })
  }
})
