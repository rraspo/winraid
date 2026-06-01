// Strip optional native modules before packaging so electron-builder's
// @electron/rebuild step has nothing to compile — no Visual Studio / C++
// toolchain required on the build machine.
//
// cpu-features is an OPTIONAL dependency of ssh2 used only to auto-detect CPU
// crypto features. ssh2 wraps require('cpu-features') in try/catch and falls
// back to Node's built-in OpenSSL crypto when it's absent, so removing it has
// no functional impact on SFTP. Self-healing: npm install restores it, and
// this script runs again on the next build.

const { rmSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')

const targets = [
  'node_modules/ssh2/lib/protocol/crypto/build/node_gyp_bins',
  'node_modules/cpu-features',
]

for (const rel of targets) {
  rmSync(join(root, rel), { recursive: true, force: true })
}

console.log('  Stripped optional native modules (cpu-features) — toolchain-free build.')
