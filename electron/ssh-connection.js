import { Client } from 'ssh2'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { getPinnedHostKey, pinHostKey } from './known-hosts.js'

// ---------------------------------------------------------------------------
// SSH connection setup — the single place a connection to a NAS is configured
// and established (WR-36). Previously the ssh2 config object and the tilde
// expansion of keyPath were written ~6 times across main.js and the SFTP
// backend, with two divergent tilde-expansion variants. Consolidating them
// here means a fix — or the WR-07 host-key check — is applied once.
// ---------------------------------------------------------------------------

/**
 * Expand a leading `~` in a key path to the user's home directory. Single
 * canonical implementation: strips the `~` and any immediately following path
 * separator, then joins onto the home dir so the result is a proper path.
 *
 * @param {string | undefined} keyPath
 * @returns {string | undefined}
 */
export function expandKeyPath(keyPath) {
  if (!keyPath || !keyPath.startsWith('~')) return keyPath
  return join(homedir(), keyPath.slice(1).replace(/^[/\\]/, ''))
}

/**
 * Build the ssh2 `connect()` config from a connection record. Reads the
 * private key from disk (tilde-expanded) when `keyPath` is set; otherwise uses
 * the password. A caller may pass `password` to override `cfg.password` (the
 * connection pool passes a decrypted password).
 *
 * On key-read failure throws an Error tagged `code: 'KEY_READ_FAILED'` and
 * prefixed `Cannot read key file:` so callers can preserve their existing
 * user-facing message.
 *
 * @param {{ host: string, port?: number, username: string, password?: string, keyPath?: string }} cfg
 * @param {{ readyTimeout?: number, password?: string }} [options]
 * @returns {Promise<object>} an ssh2 connect() config
 */
export async function getConnConfig(cfg, { readyTimeout = 10_000, password } = {}) {
  const config = {
    host:         cfg.host,
    port:         cfg.port || 22,
    username:     cfg.username,
    password:     (password ?? cfg.password)?.trim() || undefined,
    readyTimeout,
  }

  if (cfg.keyPath) {
    try {
      config.privateKey = await readFile(expandKeyPath(cfg.keyPath))
    } catch (err) {
      throw Object.assign(new Error(`Cannot read key file: ${err.message}`), { code: 'KEY_READ_FAILED' })
    }
  }

  return config
}

/**
 * Fingerprint a host key the way OpenSSH prints one (`SHA256:` + unpadded
 * base64), so what the app shows can be compared by eye against `ssh-keyscan`
 * or the NAS's own admin page.
 *
 * @param {Buffer} key raw host key, as ssh2 hands it to hostVerifier
 * @returns {string}
 */
export function hostKeyFingerprint(key) {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

/**
 * Create an ssh2 Client and connect it. Resolves with the connected Client on
 * `ready`, rejects on `error` (including a tagged key-read failure before any
 * client is constructed). The single connection primitive used by every SSH
 * consumer; callers perform their own post-`ready` work (sftp, exec, …).
 *
 * Host keys are pinned trust-on-first-use (WR-07): ssh2 auto-accepts any key
 * when no `hostVerifier` is set, which let anything on the LAN answer as the
 * NAS and collect the credentials. The first connect records the fingerprint;
 * later connects must present the same one.
 *
 * A mismatch is reported as `code: 'HOST_KEY_CHANGED'` rather than the generic
 * handshake failure ssh2 raises, because the two need opposite responses from
 * the user: retry, versus stop and find out why the key changed.
 *
 * @param {object} cfg     connection record (see getConnConfig)
 * @param {{ readyTimeout?: number, password?: string, pinHostKeys?: boolean }} [options]
 *   `pinHostKeys: false` verifies against an existing pin but never records a
 *   new one — for processes that must not write the config.
 * @returns {Promise<import('ssh2').Client>}
 */
export async function createSshConnection(cfg, options = {}) {
  const config = await getConnConfig(cfg, options)
  const port = cfg.port || 22

  const mayPin = options.pinHostKeys !== false

  let mismatch = null
  config.hostVerifier = (key) => {
    const presented = hostKeyFingerprint(key)
    const pinned = getPinnedHostKey(cfg.host, port)
    if (!pinned) {
      // Nothing pinned yet: trust once and record it. The transfer worker is
      // told not to record (pinHostKeys: false) — config writes are
      // read-modify-write over a per-process cache, so a write from there
      // could clobber a change the main process made. It still enforces a pin
      // that already exists, which is the case an impersonator has to beat.
      if (mayPin) pinHostKey(cfg.host, port, presented)
      return true
    }
    if (pinned === presented) return true
    mismatch = { pinned, presented }
    return false
  }

  return new Promise((resolve, reject) => {
    const client = new Client()
    client
      .on('ready', () => resolve(client))
      .on('error', (err) => reject(mismatch
        ? Object.assign(
          new Error(
            `The host key for ${cfg.host} changed. It may be a different machine. ` +
            `Expected ${mismatch.pinned}, got ${mismatch.presented}. ` +
            `If you re-installed or replaced the NAS, forget the saved key for this host and reconnect.`,
          ),
          { code: 'HOST_KEY_CHANGED', host: cfg.host, port, ...mismatch },
        )
        : err))
      .connect(config)
  })
}
