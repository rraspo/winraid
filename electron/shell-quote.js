// Safely embed an arbitrary string as a single shell argument for SSH exec.
// POSIX single-quote escaping: everything inside '...' is literal; a literal
// single quote is written as '\'' (close quote, escaped quote, reopen quote).
// Control characters are rejected outright — they are never valid in the paths
// we build commands from and are the nastiest injection/parse vectors.
export function shQuote(str) {
  if (typeof str !== 'string') throw new TypeError('shQuote: expected a string')
  if (/[\x00-\x1f\x7f]/.test(str)) throw new Error('shQuote: control characters are not allowed')
  return `'${str.replace(/'/g, "'\\''")}'`
}
