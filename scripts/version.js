const { execSync } = require('child_process')

const tags = execSync('git tag --sort=-v:refname', { encoding: 'utf8' }).trim()
const last = tags.split('\n').find(t => /^v\d+\.\d+\.\d+$/.test(t))

console.log(last || '(no tags yet)')
