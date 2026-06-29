// Pure mapping from a user-facing operation to its activity display + navigation.
// Dependency-free so the wording and nav-target logic are unit-testable and
// shared by main.js and worker.js. `level` is NOT decided here — the call site
// sets it from the outcome (info on success, error on failure, warn for
// verify-missing) and forces nav:null on failure.

function joinRemote(base, name) {
  const b = (base || '/').replace(/\/+$/, '')
  return b === '' ? `/${name}` : `${b}/${name}`
}

/**
 * @param {string} type
 * @param {object} payload op specifics (names, dirs, flags)
 * @returns {{ title: string, detail?: string, nav: object|null }}
 */
export function describeActivity(type, payload = {}) {
  switch (type) {
    case 'upload':
      return {
        title: `Uploaded ${payload.name}`,
        detail: payload.destDir,
        nav: { kind: 'remote', path: payload.destDir, highlight: payload.name },
      }

    case 'move':
      return {
        title: `Moved ${payload.name}`,
        detail: `→ ${payload.dstDir}`,
        nav: payload.isDir
          ? { kind: 'remote', path: joinRemote(payload.dstDir, payload.name) }
          : { kind: 'remote', path: payload.dstDir, highlight: payload.name },
      }

    case 'rename':
      return {
        title: `Renamed ${payload.oldName} → ${payload.newName}`,
        nav: { kind: 'remote', path: payload.dir, highlight: payload.newName },
      }

    case 'delete':
      return {
        title: `Deleted ${payload.name}`,
        detail: payload.parentDir,
        nav: { kind: 'remote', path: payload.parentDir },
      }

    case 'mkdir':
      return {
        title: `Created ${payload.name}`,
        detail: payload.parentDir,
        nav: { kind: 'remote', path: joinRemote(payload.parentDir, payload.name) },
      }

    case 'checkout':
      return {
        title: `Checked out ${payload.count} folder${payload.count === 1 ? '' : 's'}`,
        detail: payload.localDir,
        nav: { kind: 'reveal', localPath: payload.localDir },
      }

    case 'download':
      return {
        title: `Downloaded ${payload.name}`,
        detail: payload.localDir,
        nav: { kind: 'reveal', localPath: payload.localDir },
      }

    case 'verify-missing':
      return {
        title: `Missing on NAS: ${payload.name}`,
        nav: { kind: 'remote', path: payload.parentDir },
      }

    default:
      return { title: String(type), nav: null }
  }
}

const FAILURE_TITLES = {
  upload:   'Upload failed',
  move:     'Move failed',
  rename:   'Rename failed',
  delete:   'Delete failed',
  mkdir:    'Create folder failed',
  checkout: 'Checkout failed',
  download: 'Download failed',
}

/** Title for a failed operation (the entry's detail carries the error text). */
export function failureTitle(type) {
  return FAILURE_TITLES[type] ?? 'Operation failed'
}
