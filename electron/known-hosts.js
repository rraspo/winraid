import { getConfig, setConfig } from './config.js'

// Pinned SSH host-key fingerprints, this app's known_hosts. Stored in
// the config under `knownHostKeys` as { "host:port": "SHA256:..." }.
//
// Keyed by host and port rather than by connection id on purpose: the trust
// decision belongs to the machine, so two connection records pointing at the
// same NAS share one pin, and re-adding a connection does not silently re-trust
// whatever answers.

export function hostKeyId(host, port) {
  return `${host}:${port || 22}`
}

export function getPinnedHostKey(host, port) {
  return (getConfig('knownHostKeys') ?? {})[hostKeyId(host, port)]
}

export function pinHostKey(host, port, fingerprint) {
  setConfig('knownHostKeys', { ...(getConfig('knownHostKeys') ?? {}), [hostKeyId(host, port)]: fingerprint })
}

// Deliberately drop a pin, so the next connect trusts what it finds. The only
// supported way back from a rejected host key: a changed key is either the
// admin's own doing or an attack, and only the user can tell which.
export function forgetHostKey(host, port) {
  const pins = { ...(getConfig('knownHostKeys') ?? {}) }
  delete pins[hostKeyId(host, port)]
  setConfig('knownHostKeys', pins)
}
