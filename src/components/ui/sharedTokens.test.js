import { describe, it, expect } from 'vitest'
import { findColorLiterals } from '../../test-utils/cssTokens'

// The shared surfaces (modals, toasts, buttons, progress, tooltips, badges,
// the paste and new-folder prompts, the drag ghost and the What's New
// window) are on the redesign: every color comes from a design token.
const SHARED_MODULES = [
  'src/components/modals/modals.module.css',
  'src/components/modals/PasteImageModal.module.css',
  'src/components/browse/NewFolderPrompt.module.css',
  'src/components/browse/DragGhost.module.css',
  'src/components/ui/Button.module.css',
  'src/components/ui/Badge.module.css',
  'src/components/ui/ProgressBar.module.css',
  'src/components/ui/ProgressRing.module.css',
  'src/components/ui/SegmentedControl.module.css',
  'src/components/ui/Toast.module.css',
  'src/components/ui/Tooltip.module.css',
  'src/views/WhatsNew.module.css',
]

describe('shared component CSS uses design tokens only', () => {
  for (const modulePath of SHARED_MODULES) {
    it(`${modulePath} has no color literals`, () => {
      const literals = findColorLiterals(modulePath)
      expect(literals, `color literals in ${modulePath}: ${literals.join(', ')}`).toEqual([])
    })
  }
})
