// Cross-platform release script: runs the lint + test quality gate, then
// bumps the version, tags, and pushes. The installer build and GitHub Release
// are produced by CI (.github/workflows/release.yml) on the pushed v* tag —
// this script never builds or publishes locally. It differs from `make tag`
// only in that it enforces the quality gate before tagging.
//
// Usage:
//   node scripts/release.js                 → bump patch
//   node scripts/release.js minor           → bump minor
//   node scripts/release.js major           → bump major
//   node scripts/release.js --tag v2.0.0    → exact tag

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { assertReleasable, assertQualityGate } = require('./release-guards')

const root = path.resolve(__dirname, '..')

// ── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, opts) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: 'inherit', ...opts })
}

function runSilent(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
}

function log(msg) { console.log(`  ${msg}`) }
function die(msg) { console.error(`  ERROR: ${msg}`); process.exit(1) }

// ── Guards ──────────────────────────────────────────────────────────────────
// Refuse to release from a dirty tree or off-branch checkout — running
// `make release` from a feature branch would otherwise publish unmerged,
// dirty code as the release branch. RELEASE_BRANCH lets a maintainer release
// from a different branch on purpose.
const releaseBranch = process.env.RELEASE_BRANCH || 'master'
let currentBranch
try {
  currentBranch = assertReleasable({ runSilent, releaseBranch })
} catch (err) {
  die(err.message)
}

// Lint + test gate — fail closed. `run` uses stdio: 'inherit' and execSync's
// default behavior of throwing on a non-zero exit code, so a failing lint or
// test run halts the script here, before any version bump, build, tag, push,
// or publish happens.
log('Running lint + test gate...')
assertQualityGate({ run })

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
let explicitTag = null
let bumpType = 'patch'

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tag' && args[i + 1]) {
    explicitTag = args[++i]
  } else if (['major', 'minor', 'patch'].includes(args[i])) {
    bumpType = args[i]
  }
}

// ── Resolve version ─────────────────────────────────────────────────────────

const tags = runSilent('git tag --sort=-v:refname')
const lastTag = tags.split('\n').find(t => /^v\d+\.\d+\.\d+$/.test(t)) || ''

let releaseTag
if (explicitTag) {
  releaseTag = explicitTag
} else if (!lastTag) {
  releaseTag = 'v0.1.0'
} else {
  const [M, m, p] = lastTag.slice(1).split('.').map(Number)
  const next = bumpType === 'major' ? [M + 1, 0, 0]
             : bumpType === 'minor' ? [M, m + 1, 0]
             : [M, m, p + 1]
  releaseTag = 'v' + next.join('.')
}

const releaseVer = releaseTag.replace(/^v/, '')

// ── Validate ────────────────────────────────────────────────────────────────

if (!/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
  die(`TAG must match vMAJOR.MINOR.PATCH (got: ${releaseTag})`)
}

if (tags.split('\n').includes(releaseTag)) {
  die(`tag ${releaseTag} already exists`)
}

// ── Execute ─────────────────────────────────────────────────────────────────

console.log()
log(`Releasing ${releaseTag}`)
console.log()

// Bump package.json
log(`Bumping package.json to ${releaseVer}`)
const pkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.version = releaseVer
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

run('git add package.json')
try {
  runSilent('git diff --cached --quiet')
} catch {
  run(`git commit -m "Bump version to ${releaseVer}"`)
}

// Tag and push — the build and GitHub Release are produced by CI
// (.github/workflows/release.yml) when the v* tag lands on the remote. This
// script deliberately does NOT build or publish locally: doing so would
// double-publish against the CI job on the same tag (see README > Releases).
run(`git tag ${releaseTag}`)
run(`git push origin ${currentBranch}`)
run(`git push origin ${releaseTag}`)

console.log()
log(`Tagged and pushed ${releaseTag} — CI is building and publishing the release`)
console.log()
