import { describe, it, expect } from 'vitest'
import { buildRemoteTreeCommand } from './remote-tree-cmd.js'

// Everything the shell would evaluate: the command with its single-quoted
// literals removed. A path that only ever appears inside those spans cannot be
// expanded, no matter what it contains. POSIX escapes an embedded quote as
// '\'' (close, escaped quote, reopen), so that sequence is neutralised first —
// otherwise the split it creates reads as if the literal had ended.
function outsideQuotes(cmd) {
  return cmd.replace(/'\\''/g, '\u0000').replace(/'[^']*'/g, '')
}

describe('buildRemoteTreeCommand', () => {
  it('walks the tree and prints type, size, mtime and the root-relative path', () => {
    const cmd = buildRemoteTreeCommand('/share/media')
    expect(cmd).toContain("find '/share/media' -mindepth 1")
    expect(cmd).toContain('-not -name')
    expect(cmd).toContain('while IFS= read -r p')
    expect(cmd).toContain('stat -c')
    expect(cmd).toContain('printf')
  })

  it('skips the NAS noise directories', () => {
    const cmd = buildRemoteTreeCommand('/share/media')
    expect(cmd).toContain('@eaDir')
    expect(cmd).toContain('#recycle')
    expect(cmd).toContain('.@__thumb')
  })

  // The root used to be interpolated raw into "${p#<root>/}", where command
  // substitution still expands. A directory anyone can create on the NAS then
  // ran commands as the SSH user.
  it('never lets a command substitution in the path reach an expandable position', () => {
    const cmd = buildRemoteTreeCommand('/share/x$(reboot)')
    expect(outsideQuotes(cmd)).not.toContain('reboot')
  })

  it('neutralises backticks and shell metacharacters in the path', () => {
    for (const evil of ['/share/`reboot`', '/share/a;reboot', '/share/a|reboot', '/share/$IFS/reboot', '/share/a&reboot']) {
      expect(outsideQuotes(buildRemoteTreeCommand(evil))).not.toContain('reboot')
    }
  })

  it('escapes a single quote in the path so it cannot close the literal', () => {
    const cmd = buildRemoteTreeCommand("/share/a'b")
    expect(cmd).toContain("'/share/a'\\''b'")
    expect(outsideQuotes(cmd)).not.toContain('b')
  })

  // Quoting the root inside ${p#...} keeps it a literal prefix; unquoted it is
  // a glob pattern, so a root with * or ? would strip the wrong prefix.
  it('strips the root as a literal prefix, not as a glob pattern', () => {
    const cmd = buildRemoteTreeCommand('/share/a*b')
    expect(cmd).toContain('${p#"$root"/}')
    expect(cmd).not.toContain('${p#/share/a*b/}')
  })

  it('assigns the root from a quoted literal and normalises trailing slashes', () => {
    expect(buildRemoteTreeCommand('/share/media/')).toContain("root='/share/media'")
    expect(buildRemoteTreeCommand('/')).toContain("root='/'")
  })

  it('rejects a path with control characters rather than emitting a command', () => {
    expect(() => buildRemoteTreeCommand('/share/a\nreboot')).toThrow()
  })
})
