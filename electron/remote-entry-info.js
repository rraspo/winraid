// Attributes for a single remote entry — permission mode, owner, group, birth
// time where reported, and symlink detection — the data the file listing
// itself never carries (remote-list.js follows symlinks and only reports
// type/size/mtime). Pure command-builders + a parser so the shape can be
// tested without an SSH connection; main.js runs the commands and calls
// readlinkCommand only when parseEntryInfoOutput reports a symlink.

import { shQuote } from './shell-quote.js'

/** Stats the path itself (never follows a symlink) so a link reports as a
 *  link rather than whatever it points to. */
export function entryInfoCommand(remotePath) {
  return `stat -c '%a\\t%U\\t%G\\t%W\\t%F' -- ${shQuote(remotePath)}`
}

/** Reads a symlink's immediate target — not resolved through further links. */
export function readlinkCommand(remotePath) {
  return `readlink -- ${shQuote(remotePath)}`
}

/** Parses `%a\t%U\t%G\t%W\t%F` output into the fields Properties needs.
 *  Birth time (`%W`) is 0 on filesystems that don't track it, reported here
 *  as `null` ("not reported by the server") rather than the epoch. */
export function parseEntryInfoOutput(stdout) {
  const line = (stdout || '').split('\n')[0] ?? ''
  const parts = line.split('\t')
  if (parts.length < 5) return null
  const [modeStr, owner, group, birthStr, typeDesc] = parts
  const birthEpoch = parseInt(birthStr, 10)
  return {
    mode: modeStr.trim(),
    owner: owner.trim(),
    group: group.trim(),
    created: Number.isFinite(birthEpoch) && birthEpoch > 0 ? birthEpoch * 1000 : null,
    isSymlink: typeDesc.trim().includes('symbolic link'),
  }
}

/** Converts a stat "%a" octal mode ("755") into an rwx triplet
 *  ("rwxr-xr-x"). Returns null for anything that isn't a 3-4 digit octal
 *  mode rather than throwing on unexpected server output. */
export function formatMode(octalStr) {
  if (typeof octalStr !== 'string') return null
  const trimmed = octalStr.trim()
  if (!/^[0-7]{3,4}$/.test(trimmed)) return null
  const digits = trimmed.slice(-3).split('').map(Number)
  const bits = ['r', 'w', 'x']
  return digits
    .map((d) => bits.map((b, i) => (d & (4 >> i) ? b : '-')).join(''))
    .join('')
}
