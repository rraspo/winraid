import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// Quick Look and the PDF preview are on the redesign: every color comes
// from a design token.
describe('Quick Look CSS uses design tokens only', () => {
  for (const modulePath of ['src/components/QuickLookOverlay.module.css', 'src/components/PdfPreview.module.css']) {
    it(`${modulePath} has no color literals`, () => {
      const literals = findColorLiterals(modulePath)
      expect(literals, `color literals in ${modulePath}: ${literals.join(', ')}`).toEqual([])
    })
  }
})
