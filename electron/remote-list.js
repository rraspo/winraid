// Remote directory listing over SSH: a single `find -printf` so the whole
// directory is described in ONE process, instead of spawning stat/basename per
// file (which makes large folders crawl). Pure + dependency-free for testing;
// main.js runs the command and falls back to sftp.readdir when find/-printf is
// unavailable (busybox / restricted shells).

import { TRASH_DIR } from './trash.js'

const NOISE = ["-not -name '.*'", "-not -name '@eaDir'", "-not -name '#recycle'", "-not -name '.@__thumb'"].join(' ')

/** One-process listing command. `-L` so a symlinked dir still reports as a dir.
 *  Widened past type/size/mtime/name with the attributes Properties used to
 *  pay a second round trip for: permission mode (%m), owner and group NAMES
 *  (%u/%g — find resolves these; readdir below cannot), numeric uid/gid
 *  (%U/%G), and the symlink target (%l, empty for anything that isn't a
 *  link). GNU find only — the BusyBox find some NAS boxes ship has no
 *  -printf at all, so it fails this command outright (non-zero exit / thrown
 *  exec error) and main.js's existing fallback to sftp.readdir takes over;
 *  there is no partial/degraded acceptance of a narrower -printf here.
 */
export function listCommand(remotePath) {
  const safe = remotePath.replace(/'/g, "'\\''")
  return `find -L '${safe}' -mindepth 1 -maxdepth 1 ${NOISE} -printf '%y\\t%s\\t%T@\\t%f\\t%m\\t%u\\t%g\\t%U\\t%G\\t%l\\n'`
}

/**
 * Map an sftp.readdir listing — the fallback when find is unavailable — into
 * entries. The app's trash is dropped by name rather than left to the caller's
 * dot-name filter, so it stays out of the browser if that filter ever changes.
 *
 * readdir's attrs blob carries permission bits, uid and gid numerically —
 * unlike find, it cannot resolve owner/group to names or report a symlink
 * target, so those stay `null` (never an empty string, never the numeric id
 * standing in for a name) so a caller can tell "this path has no name" from
 * "the server didn't answer".
 */
export function readdirEntries(list) {
  return (list || [])
    .filter((item) => item.filename !== TRASH_DIR)
    .map((item) => {
      const mode = item.attrs?.mode ?? 0
      return {
        name:     item.filename,
        type:     (mode & 0o170000) === 0o040000 ? 'dir' : 'file',
        size:     item.attrs?.size ?? 0,
        modified: (item.attrs?.mtime ?? 0) * 1000,
        mode:     (mode & 0o7777).toString(8),
        owner:    null,
        group:    null,
        uid:      item.attrs?.uid ?? null,
        gid:      item.attrs?.gid ?? null,
        target:   null,
      }
    })
}

/** Parse `%y\t%s\t%T@\t%f\t%m\t%u\t%g\t%U\t%G\t%l` lines into entries. Only
 *  the first four columns are required — a line carrying just those (the
 *  pre-widening shape) still parses into the plain four-field entry, with no
 *  extra keys tacked on — but a line with a blank type column is rejected
 *  outright rather than guessed at. */
export function parseListOutput(stdout) {
  const entries = []
  for (const line of (stdout || '').split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 4) continue
    const [type, sizeStr, mtStr, name, modeStr, owner, group, uidStr, gidStr, targetStr] = parts
    if (!type) continue
    if (!name || name === '.') continue
    const entry = {
      name,
      type: type === 'd' ? 'dir' : 'file',
      size: parseInt(sizeStr, 10) || 0,
      modified: Math.round((parseFloat(mtStr) || 0) * 1000),
    }
    if (parts.length > 4) {
      const uid = parseInt(uidStr, 10)
      const gid = parseInt(gidStr, 10)
      entry.mode = modeStr || null
      entry.owner = owner || null
      entry.group = group || null
      entry.uid = Number.isFinite(uid) ? uid : null
      entry.gid = Number.isFinite(gid) ? gid : null
      entry.target = targetStr || null
    }
    entries.push(entry)
  }
  return entries
}
