import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A `position: fixed` rule whose `inset` is a bare `0` covers the whole
// viewport, title bar included — on Windows that steals the drag region
// the OS treats as window caption, and paints over Minimize/Maximize/Close.
// Every full-window fixed layer instead starts at `var(--titlebar-height)`
// (see src/styles/tokens.css). Returns the selectors of any rule that still
// uses the bare form, so a test can name them.

const RULE = /([^{}]+)\{([^{}]*)\}/g

export function findFixedFullWindowInsetZero(modulePath) {
  const css = readFileSync(resolve(process.cwd(), modulePath), 'utf8')
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const offenders = []
  let match
  while ((match = RULE.exec(withoutComments))) {
    const [, selector, body] = match
    const isFixed = /position\s*:\s*fixed\s*;/.test(body)
    const bareInsetZero = /inset\s*:\s*0\s*;/.test(body)
    if (isFixed && bareInsetZero) offenders.push(selector.trim())
  }
  return offenders
}
