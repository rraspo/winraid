import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// jsdom has no cascade-accurate var() resolution, so this asserts the
// stylesheet structure that makes nested theme scopes (Quick Look and the
// move picker force data-theme="dark" inside a light app) re-resolve.
const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function rules() {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: selector.split(',').map((part) => part.trim()),
    body,
  }))
}

describe('token scoping', () => {
  it('declares alias tokens in a rule that also matches nested [data-theme] scopes', () => {
    const aliasRule = rules().find((rule) => /--text-muted\s*:/.test(rule.body))
    expect(aliasRule.selectors).toContain('[data-theme]')
    expect(aliasRule.selectors).toContain(':root')
  })

  it('keeps every alias token out of :root-only rules', () => {
    const rootOnly = rules().filter(
      (rule) => rule.selectors.length === 1 && rule.selectors[0] === ':root',
    )
    for (const rule of rootOnly) {
      expect(rule.body).not.toMatch(/--(bg-card|bg-hover|text-muted|text-faint|accent-subtle)\s*:/)
    }
  })

  it('declares --accent and --onAccent only on :root, never in a theme scope', () => {
    for (const rule of rules()) {
      if (!/--(accent|onAccent)\s*:/.test(rule.body)) continue
      expect(rule.selectors).toEqual([':root'])
    }
  })
})
