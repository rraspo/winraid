import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The tray flyout is on the redesign: every color comes from a design token.
describe('tray flyout CSS uses design tokens only', () => {
  it('src/views/TrayFlyout.module.css has no color literals', () => {
    const literals = findColorLiterals('src/views/TrayFlyout.module.css')
    expect(literals, `color literals: ${literals.join(', ')}`).toEqual([])
  })
})
