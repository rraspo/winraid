import { Client } from 'ssh2'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

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

  // WR-07 seam: attach `config.hostVerifier` here to enable host-key checking
  // for every SSH consumer at once.

  return config
}

/**
 * Create an ssh2 Client and connect it. Resolves with the connected Client on
 * `ready`, rejects on `error` (including a tagged key-read failure before any
 * client is constructed). The single connection primitive used by every SSH
 * consumer; callers perform their own post-`ready` work (sftp, exec, …).
 *
 * @param {object} cfg     connection record (see getConnConfig)
 * @param {{ readyTimeout?: number, password?: string }} [options]
 * @returns {Promise<import('ssh2').Client>}
 */
export async function createSshConnection(cfg, options = {}) {
  const config = await getConnConfig(cfg, options)
  return new Promise((resolve, reject) => {
    const client = new Client()
    client
      .on('ready', () => resolve(client))
      .on('error', reject)
      .connect(config)
  })
}
