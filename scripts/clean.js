const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

for (const dir of ['out', 'release']) {
  fs.rmSync(path.join(root, dir), { recursive: true, force: true })
}

console.log('  Cleaned out/ and release/')
