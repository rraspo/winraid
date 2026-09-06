import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The Queue is on the redesign: every color comes from a design token.
describe('Queue CSS uses design tokens only', () => {
  it('src/views/QueueView.module.css has no color literals', () => {
    const literals = findColorLiterals('src/views/QueueView.module.css')
    expect(literals, `color literals: ${literals.join(', ')}`).toEqual([])
  })
})
