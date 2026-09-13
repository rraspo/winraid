// Remote directory listing over SSH: a single `find -printf` so the whole
// directory is described in ONE process, instead of spawning stat/basename per
// file (which makes large folders crawl). Pure + dependency-free for testing;
// main.js runs the command and falls back to sftp.readdir when find/-printf is
// unavailable (busybox / restricted shells).

import { TRASH_DIR } from './trash.js'

const NOISE = ["-not -name '.*'", "-not -name '@eaDir'", "-not -name '#recycle'", "-not -name '.@__thumb'"].join(' ')

/** One-process listing command. `-L` so a symlinked dir still reports as a dir. */
export function listCommand(remotePath) {
  const safe = remotePath.replace(/'/g, "'\\''")
  return `find -L '${safe}' -mindepth 1 -maxdepth 1 ${NOISE} -printf '%y\\t%s\\t%T@\\t%f\\n'`
}

/**
 * Map an sftp.readdir listing — the fallback when find is unavailable — into
 * entries. The app's trash is dropped by name rather than left to the caller's
 * dot-name filter, so it stays out of the browser if that filter ever changes.
 */
export function readdirEntries(list) {
  return (list || [])
    .filter((item) => item.filename !== TRASH_DIR)
    .map((item) => ({
      name:     item.filename,
      type:     ((item.attrs?.mode ?? 0) & 0o170000) === 0o040000 ? 'dir' : 'file',
      size:     item.attrs?.size ?? 0,
      modified: (item.attrs?.mtime ?? 0) * 1000,
    }))
}

/** Parse `%y\t%s\t%T@\t%f` lines into entries. */
export function parseListOutput(stdout) {
  const entries = []
  for (const line of (stdout || '').split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 4) continue
    const [type, sizeStr, mtStr, name] = parts
    if (!name || name === '.') continue
    entries.push({
      name,
      type: type === 'd' ? 'dir' : 'file',
      size: parseInt(sizeStr, 10) || 0,
      modified: Math.round((parseFloat(mtStr) || 0) * 1000),
    })
  }
  return entries
}
