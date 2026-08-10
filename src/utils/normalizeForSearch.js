// Folds diacritics and case so search/filter/type-ahead matching is
// accent-insensitive: an unaccented query like "andre" finds "Andrés".
//
// NFD decomposition splits each accented character into a base letter plus a
// combining mark (e.g. "e" + U+0301 for the accent on "e"); stripping the
// Unicode combining-diacritical-marks block (U+0300-U+036F) then leaves the
// plain base letter. This also folds "n" + combining tilde to a plain "n" —
// in Spanish "n" with a tilde is its own letter, not an accented "n", but
// that fold is the accepted trade-off for accent-insensitive search per the
// house rule.
export function normalizeForSearch(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}
