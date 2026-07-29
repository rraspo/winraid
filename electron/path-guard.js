import { resolve, sep } from 'path'

// True when filePath lands strictly inside base, once both are normalised.
//
// The trailing separator is the whole point: comparing resolved prefixes alone
// accepts "/srv/watched-evil" as living inside "/srv/watched". It also means a
// base that resolves to a filesystem root admits nothing, since "/" + sep never
// prefixes a real path — callers that could hold a root (verify-delete) refuse
// one earlier with a clearer message, and failing closed beats silently
// authorising a whole disk.
//
// This is a lexical check, not a filesystem one: it does not resolve symlinks,
// so it answers "does this path name a location inside base", not "does this
// path lead there". Every caller uses it to decide where to write or delete a
// path it constructs itself, which is exactly the lexical question.
export function isWithinBase(base, filePath) {
  if (typeof base !== 'string' || typeof filePath !== 'string' || !base || !filePath) return false
  return resolve(filePath).startsWith(resolve(base) + sep)
}
