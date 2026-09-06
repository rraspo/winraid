import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The Size map and its sunburst are on the redesign: every color comes
// from a design token. The chart's slice palette is data, not chrome, and
// lives in JavaScript, so the CSS itself carries no literals.
describe('Size map CSS uses design tokens only', () => {
  for (const modulePath of ['src/views/SizeView.module.css', 'src/components/size/SizeSunburst.module.css']) {
    it(`${modulePath} has no color literals`, () => {
      const literals = findColorLiterals(modulePath)
      expect(literals, `color literals in ${modulePath}: ${literals.join(', ')}`).toEqual([])
    })
  }
})
