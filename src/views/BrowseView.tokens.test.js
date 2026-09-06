import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../test-utils/cssTokens'

// The remote browser, its cards, rows, menus, thumbnails and the tab strip
// are on the redesign: every color comes from a design token.
const BROWSER_MODULES = [
  'src/views/BrowseView.module.css',
  'src/views/BrowseGrid.module.css',
  'src/views/BrowseList.module.css',
  'src/components/browse/GridCard.module.css',
  'src/components/browse/EntryMenu.module.css',
  'src/components/browse/Thumbnail.module.css',
  'src/components/browse/VideoThumb.module.css',
  'src/components/TabBar.module.css',
]

describe('browser CSS uses design tokens only', () => {
  for (const modulePath of BROWSER_MODULES) {
    it(`${modulePath} has no color literals`, () => {
      const literals = findColorLiterals(modulePath)
      expect(literals, `color literals in ${modulePath}: ${literals.join(', ')}`).toEqual([])
    })
  }
})
