// Remote directory listing over SSH: a single `find -printf` so the whole
// directory is described in ONE process, instead of spawning stat/basename per
// file (which makes large folders crawl). Pure + dependency-free for testing;
// main.js runs the command and falls back to sftp.readdir when find/-printf is
// unavailable (busybox / restricted shells).

const NOISE = ["-not -name '.*'", "-not -name '@eaDir'", "-not -name '#recycle'", "-not -name '.@__thumb'"].join(' ')

/** One-process listing command. `-L` so a symlinked dir still reports as a dir. */
export function listCommand(remotePath) {
  const safe = remotePath.replace(/'/g, "'\\''")
  return `find -L '${safe}' -mindepth 1 -maxdepth 1 ${NOISE} -printf '%y\\t%s\\t%T@\\t%f\\n'`
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
