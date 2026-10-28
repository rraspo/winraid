// Renders the GitHub release notes for a tag: the What's New highlights from
// src/whatsNew.json, then the user-facing fixes since the previous tag.
// CI runs it on the pushed v* tag and attaches the output to the release.
//
// Usage: node scripts/release-notes.js v3.1.1 > release-notes.md

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// Fixes to the test suite, build or CI never reach a user.
const INTERNAL_SCOPES = new Set(['test', 'build', 'ci'])

function userFacingFix(subject) {
  const match = subject.match(/^fix(?:\(([^)]+)\))?!?:\s*(.+)$/)
  if (!match || INTERNAL_SCOPES.has(match[1])) return null
  return match[2].charAt(0).toUpperCase() + match[2].slice(1)
}

function renderReleaseNotes({ highlights, subjects }) {
  const lines = ['## Highlights', '']
  for (const { title, body } of highlights) lines.push(`- **${title}** — ${body}`)

  const fixes = subjects.map(userFacingFix).filter(Boolean)
  if (fixes.length > 0) {
    lines.push('', '## Fixes', '')
    for (const fix of fixes) lines.push(`- ${fix}`)
  }
  return lines.join('\n') + '\n'
}

module.exports = { renderReleaseNotes }

if (require.main === module) {
  const tag = process.argv[2]
  if (!tag) {
    console.error('usage: node scripts/release-notes.js <tag>')
    process.exit(1)
  }
  const root = path.resolve(__dirname, '..')
  const git = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
  const previousTag = git(`git describe --tags --abbrev=0 --match "v*" ${tag}^`)
  const subjects = git(`git log --no-merges --format=%s ${previousTag}..${tag}`).split('\n').filter(Boolean)
  const { highlights } = JSON.parse(fs.readFileSync(path.join(root, 'src', 'whatsNew.json'), 'utf8'))
  process.stdout.write(renderReleaseNotes({ highlights, subjects }))
}
