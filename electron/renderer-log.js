// Entries the renderer asks the main process to write to the log file. Only
// short scalar facts are accepted (an error name, a remote path) — never file
// content — and each entry is flattened to a single line.
const LEVELS = new Set(['info', 'warn', 'error'])
const MAX_MESSAGE = 1000

function oneLine(value) {
  return String(value).replace(/[\r\n]+/g, ' ')
}

export function formatRendererLog(entry) {
  if (!entry || typeof entry.scope !== 'string' || !entry.scope) return null
  if (typeof entry.message !== 'string' || !entry.message) return null

  const detailParts = Object.entries(entry.details ?? {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}=${oneLine(value)}`)
  const suffix = detailParts.length ? ` (${detailParts.join(', ')})` : ''
  const message = `[${oneLine(entry.scope)}] ${oneLine(entry.message).slice(0, MAX_MESSAGE)}${suffix}`
  return { level: LEVELS.has(entry.level) ? entry.level : 'error', message }
}
