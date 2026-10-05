import { shQuote } from './shell-quote.js'
import { TRASH_DIR } from './trash.js'

// Directories every NAS scatters around that are noise in a file tree.
const NOISE_FILTER = `-not -path '*/@eaDir*' -not -name '#recycle' -not -name '.@__thumb'`

// The app's trash is pruned rather than filtered: `-not -name '.*'` hides the
// trash directory's own line but find still descends into it and prints every
// deleted file as an ordinary one, which the Size map would then count.
const TRASH_PRUNE = `-name ${shQuote(TRASH_DIR)} -prune -o`

// One `find` walk of rootPath, printing a tab-separated
// type/size/mtime/root-relative-path line per entry.
//
// The root reaches the shell exactly twice, and both are quoted literals: the
// `find` argument, and a `root=` assignment the loop strips prefixes with. It
// used to be substituted straight into `"${p#<root>/}"` — a double-quoted
// context, where `$( )` and backticks still expand, so a directory named
// `/share/x$(reboot)` (which validateRemotePath allows, and which anyone able
// to write to the NAS can create) ran commands as the SSH user.
//
// `${p#"$root"/}` quotes the expansion inside the pattern too: without those
// inner quotes the root is read as a glob, so a root containing `*` or `?`
// would strip the wrong prefix.
//
// Throws on control characters in the path (via shQuote) — those cannot be
// represented safely in a command line and no real path needs them.
export function buildRemoteTreeCommand(rootPath) {
  const root = shQuote(rootPath.replace(/\/+$/, '') || '/')
  const walk = `find ${shQuote(rootPath)} -mindepth 1 ${TRASH_PRUNE} ${NOISE_FILTER} -not -name '.*' -print`

  return `root=${root}; ${walk}` +
    ` | while IFS= read -r p; do` +
    ` t=$([ -d "$p" ] && echo d || echo f);` +
    ` s=$(stat -c '%s' "$p" 2>/dev/null || echo 0);` +
    ` m=$(stat -c '%Y' "$p" 2>/dev/null || echo 0);` +
    ` rel="\${p#"$root"/}";` +
    ` printf '%s\\t%s\\t%s\\t%s\\n' "$t" "$s" "$m" "$rel";` +
    ` done`
}
