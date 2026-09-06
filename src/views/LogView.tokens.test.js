import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The Logs screen is on the redesign: every color comes from a design token.
describe('Logs CSS uses design tokens only', () => {
  it('src/views/LogView.module.css has no color literals', () => {
    const literals = findColorLiterals('src/views/LogView.module.css')
    expect(literals, `color literals: ${literals.join(', ')}`).toEqual([])
  })
})
