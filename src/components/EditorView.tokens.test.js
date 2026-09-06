import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The text editor is on the redesign: every color comes from a design token.
describe('Editor CSS uses design tokens only', () => {
  it('src/components/EditorView.module.css has no color literals', () => {
    const literals = findColorLiterals('src/components/EditorView.module.css')
    expect(literals, `color literals: ${literals.join(', ')}`).toEqual([])
  })
})
