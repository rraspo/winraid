import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The Backup screen is on the redesign: every color comes from a design token.
describe('Backup CSS uses design tokens only', () => {
  it('src/views/BackupView.module.css has no color literals', () => {
    const literals = findColorLiterals('src/views/BackupView.module.css')
    expect(literals, `color literals: ${literals.join(', ')}`).toEqual([])
  })
})
