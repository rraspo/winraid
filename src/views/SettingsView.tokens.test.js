import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// Settings is on the redesign: every color comes from a design token.
describe('Settings CSS uses design tokens only', () => {
  it('src/views/SettingsView.module.css has no color literals', () => {
    const literals = findColorLiterals('src/views/SettingsView.module.css')
    expect(literals, `color literals: ${literals.join(', ')}`).toEqual([])
  })
})
