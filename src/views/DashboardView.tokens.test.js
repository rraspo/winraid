import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The Dashboard and the activity entries it renders are on the redesign:
// every color comes from a design token.
describe('Dashboard CSS uses design tokens only', () => {
  for (const modulePath of ['src/views/DashboardView.module.css', 'src/components/ActivityEntry.module.css']) {
    it(`${modulePath} has no color literals`, () => {
      const literals = findColorLiterals(modulePath)
      expect(literals, `color literals in ${modulePath}: ${literals.join(', ')}`).toEqual([])
    })
  }
})
