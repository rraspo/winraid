// Pluggable directory-sizing tools. Pure + dependency-free so the selection,
// command-building, and output-parsing logic can be unit tested without SSH.
//
// `du` is the universal fallback (present everywhere, predictable output).
// Faster drop-in tools are listed ahead of it and used when detected. Parsing
// is deliberately strict: if a tool's output does not parse to a clean size,
// parseSizeKb returns null and the caller re-runs the query with `du`, so a
// fast tool can only ever speed things up, never produce wrong sizes.

// Fastest first; `du` last as the guaranteed fallback.
export const SIZE_TOOLS = ['diskus', 'du']

/** Pick the highest-priority tool present in `available` (a Set of names). */
export function pickSizeTool(available) {
  for (const tool of SIZE_TOOLS) {
    if (available && available.has(tool)) return tool
  }
  return 'du'
}

function shellQuote(path) {
  return `'${String(path).replace(/'/g, "'\\''")}'`
}

/** Shell command that prints the recursive size of a single path. */
export function sizeCommand(tool, path) {
  const q = shellQuote(path)
  switch (tool) {
    case 'diskus': return `diskus -b ${q}`   // bytes, machine-readable
    // -x keeps du on the filesystem it starts on, so a network mount below
    // the path (an NFS share under /mnt) is not walked over the wire.
    case 'du':
    default:       return `du -skx ${q}`      // kilobytes, "<kb>\t<path>"
  }
}

/** Shell command that lists the remote's mount table (Linux). */
export function mountsCommand() {
  return 'cat /proc/mounts'
}

/** Parse /proc/mounts output into the unique list of mount targets. */
export function parseMounts(stdout) {
  const targets = []
  for (const line of (stdout || '').split('\n')) {
    const field = line.trim().split(/\s+/)[1]
    if (!field) continue
    // /proc/mounts escapes spaces, tabs, newlines and backslashes as octal.
    const target = field.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)))
    if (!targets.includes(target)) targets.push(target)
  }
  return targets
}

function trimSlash(path) {
  return String(path).replace(/\/+$/, '') || '/'
}

/** True when `path` is itself a mount target. */
export function isMountPoint(path, mounts) {
  return mounts.includes(trimSlash(path))
}

/**
 * The tool to size `path` with. diskus has no way to stay on one filesystem,
 * so a path with another filesystem mounted below it is sized with du -x.
 */
export function toolForPath(tool, path, mounts) {
  if (tool === 'du') return 'du'
  const prefix = trimSlash(path) === '/' ? '/' : `${trimSlash(path)}/`
  return mounts.some((mount) => mount !== '/' && mount.startsWith(prefix)) ? 'du' : tool
}

/**
 * Parse a single-path size query to kilobytes, or null if the output does not
 * look like a clean size (caller then falls back to du).
 */
export function parseSizeKb(tool, stdout) {
  const text = (stdout || '').trim()
  if (!text) return null

  if (tool === 'diskus') {
    // Expect a pure byte count (optionally with thousands separators).
    const firstLine = text.split('\n')[0].trim()
    if (!/^[\d,\s]+$/.test(firstLine)) return null
    const bytes = parseInt(firstLine.replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(bytes)) return null
    return Math.round(bytes / 1024)
  }

  // du -sk: "<kb>\t<path>" (tab) or "<kb>  <path>" (busybox). Take the leading int.
  const firstLine = text.split('\n')[0].trim()
  const kb = parseInt(firstLine, 10)
  return Number.isFinite(kb) ? kb : null
}

/** Shell snippet that echoes the name of each candidate tool that exists. */
export function probeCommand(tools = SIZE_TOOLS) {
  return tools.map((t) => `command -v ${t} >/dev/null 2>&1 && echo ${t}`).join('; ')
}

/** Parse probeCommand output (one tool name per line) into a Set. */
export function parseProbe(stdout) {
  return new Set((stdout || '').split('\n').map((s) => s.trim()).filter(Boolean))
}

// One legend/chart entry for a listed child. `type` lets the renderer tell a
// folder it can drill into from a file or symlink, which readdir cannot open
// (the server answers "No such file").
export function levelEntry(child, mounts) {
  const isDir = child.type === 'dir'
  return {
    name: child.name,
    path: child.path,
    type: isDir ? 'dir' : 'file',
    sizeKb: isDir ? 0 : Math.round((child.sizeBytes || 0) / 1024),
    ...(isDir && isMountPoint(child.path, mounts) ? { status: 'mount' } : {}),
  }
}
