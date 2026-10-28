// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderReleaseNotes } from './release-notes.js'

const highlights = [
  { icon: 'History', title: 'Activity remembers', body: 'Past transfers stay listed after a restart.' },
  { icon: 'Download', title: 'Background downloads', body: 'Keep browsing while files download.' },
]

describe('renderReleaseNotes', () => {
  it('lists every highlight with its title and body', () => {
    const notes = renderReleaseNotes({ highlights, subjects: [] })
    expect(notes).toContain('## Highlights')
    expect(notes).toContain('- **Activity remembers** — Past transfers stay listed after a restart.')
    expect(notes).toContain('- **Background downloads** — Keep browsing while files download.')
  })

  it('lists user-facing fixes from the commit subjects, capitalized and without the type prefix', () => {
    const notes = renderReleaseNotes({
      highlights,
      subjects: ['fix(browse): stop scrolling from re-rendering every visible row', 'fix: lift muted text to WCAG AA'],
    })
    expect(notes).toContain('## Fixes')
    expect(notes).toContain('- Stop scrolling from re-rendering every visible row')
    expect(notes).toContain('- Lift muted text to WCAG AA')
  })

  it('leaves out features, chores, version bumps and test, build or CI fixes', () => {
    const notes = renderReleaseNotes({
      highlights,
      subjects: [
        'feat(trim): cut audio files in the trim engine',
        'chore(preview): audit contrast',
        'Bump version to 3.1.0',
        'Merge pull request #80 from rraspo/dev',
        'fix(test): normalize CRLF before parsing tokens.css',
        'fix(build): ship the pdf.js decoder licenses',
        'fix(ci): pin node',
      ],
    })
    expect(notes).not.toContain('## Fixes')
    expect(notes).not.toMatch(/trim engine|contrast|Bump|Merge|CRLF|licenses|pin node/)
  })
})
