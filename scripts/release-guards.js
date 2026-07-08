// Guards that must pass before a release is allowed to proceed.
//
// Extracted from release.js / tag.js so the failure modes are unit-testable
// without shelling out to real git. `runSilent` is injected so tests can
// stub git output instead of touching a real repo.

function assertReleasable({ runSilent, releaseBranch = 'master' } = {}) {
  if (typeof runSilent !== 'function') {
    throw new TypeError('assertReleasable requires a runSilent(cmd) function')
  }

  const currentBranch = runSilent('git rev-parse --abbrev-ref HEAD')
  if (currentBranch !== releaseBranch) {
    throw new Error(
      `release aborted: current branch is '${currentBranch}', expected '${releaseBranch}'. ` +
      `Checkout '${releaseBranch}' before releasing, or set RELEASE_BRANCH to release from a ` +
      'different branch on purpose.'
    )
  }

  const status = runSilent('git status --porcelain')
  if (status !== '') {
    throw new Error(
      'release aborted: working tree is dirty. Commit or stash your changes before releasing.\n' + status
    )
  }

  return currentBranch
}

// Fail-closed lint + test gate. `run` is injected (rather than shelling out
// directly) so this can be unit-tested without actually spawning eslint or
// vitest, and so a lint failure demonstrably prevents the test step — and
// both demonstrably prevent whatever the caller runs after this returns
// (build, tag, push, publish) — from ever running.
function assertQualityGate({ run } = {}) {
  if (typeof run !== 'function') {
    throw new TypeError('assertQualityGate requires a run(cmd) function')
  }

  run('npm run lint')
  run('npm test')
}

module.exports = { assertReleasable, assertQualityGate }
