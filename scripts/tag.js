// Tag and push without building. Same args as release.js.
// Usage:
//   node scripts/tag.js                 → bump patch
//   node scripts/tag.js minor           → bump minor
//   node scripts/tag.js --tag v2.0.0    → exact tag

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function run(cmd, opts) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: 'inherit', ...opts })
}

function runSilent(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
}

function log(msg) { console.log(`  ${msg}`) }
function die(msg) { console.error(`  ERROR: ${msg}`); process.exit(1) }

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

if (!/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
  die(`TAG must match vMAJOR.MINOR.PATCH (got: ${releaseTag})`)
}
if (tags.split('\n').includes(releaseTag)) {
  die(`tag ${releaseTag} already exists`)
}

console.log()
log(`Tagging ${releaseTag}`)
console.log()

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

run(`git tag ${releaseTag}`)
run('git push origin master')
run(`git push origin ${releaseTag}`)

console.log()
log(`Tag ${releaseTag} pushed`)
console.log()
