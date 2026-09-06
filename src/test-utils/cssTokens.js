import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A screen migrated to the redesign takes every color from the design
// tokens: its CSS modules may use `var(--token)`, `color-mix()` over
// tokens, `transparent`, `currentColor` and `inherit`, never a hex, rgb()
// or hsl() literal. Returns the literals found so a test can name them.

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g

export function findColorLiterals(modulePath) {
  const css = readFileSync(resolve(process.cwd(), modulePath), 'utf8')
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutComments.match(COLOR_LITERAL) ?? []
}
