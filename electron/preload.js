import { contextBridge, ipcRenderer } from 'electron'

// ---------------------------------------------------------------------------
// Helper — registers a one-way listener and returns a cleanup function.
// Usage in React:
//   useEffect(() => window.winraid.queue.onUpdated(handler), [])
//   The effect cleanup calls the returned unsubscribe fn automatically.
// ---------------------------------------------------------------------------
function on(channel, callback) {
  const wrapped = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// ---------------------------------------------------------------------------
// Exposed API — available on window.winraid in the renderer
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('winraid', {

  // -- App -----------------------------------------------------------------
  getVersion: () => ipcRenderer.invoke('app:version'),

  // -- Config --------------------------------------------------------------
  config: {
    /** Returns the full config object if key is omitted, or a single value. */
    get: (key) => ipcRenderer.invoke('config:get', key ?? null),
    /** Persists a single top-level key. */
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },

  // -- Native dialogs ------------------------------------------------------
  /** Opens an OS folder-picker. Resolves to the chosen path or null. */
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

  // -- Watcher -------------------------------------------------------------
  watcher: {
    /** Start the watcher for a specific connection. */
    start:  (connectionId) => ipcRenderer.invoke('watcher:start', connectionId),
    /** Stop the watcher for a specific connection, or all if omitted. */
    stop:   (connectionId) => ipcRenderer.invoke('watcher:stop', connectionId),

    /**
     * Subscribe to watcher status events.
     * @param {(status: { connectionId: string|null, watching: boolean, folder: string|null }) => void} cb
     * @returns {() => void} unsubscribe
     */
    onStatus: (cb) => on('watcher:status', cb),
  },

  // -- Queue ---------------------------------------------------------------
  queue: {
    /** Returns the full job list, optionally filtered by connectionId. */
    list:      (connectionId) => ipcRenderer.invoke('queue:list', connectionId),
    /** Re-queues a job that is in ERROR state. */
    retry:     (jobId)   => ipcRenderer.invoke('queue:retry', jobId),
    /** Removes a single ERROR job permanently. */
    remove:    (jobId)   => ipcRenderer.invoke('queue:remove', jobId),
    /** Removes all DONE jobs from the persistent store. */
    clearDone: ()        => ipcRenderer.invoke('queue:clear-done'),
    /** Enqueue a batch of files (relative paths) from a local folder for a specific connection. */
    enqueueBatch: (connectionId, localFolder, relPaths) => ipcRenderer.invoke('queue:enqueue-batch', connectionId, localFolder, relPaths),
    /** Cancel a PENDING job (removes it) or a TRANSFERRING job (marks it ERROR). */
    cancel: (jobId) => ipcRenderer.invoke('queue:cancel', jobId),

    /**
     * Subscribe to queue mutation events pushed from the main process.
     * Payload shape: { type: 'added'|'updated'|'retry'|'cleared'|'removed', jobId?, job? }
     * @returns {() => void} unsubscribe
     */
    onUpdated: (cb) => on('queue:updated', cb),

    /**
     * Subscribe to per-file transfer progress.
     * Payload: { jobId, percent, bytesTransferred, totalBytes }
     * @returns {() => void} unsubscribe
     */
    onProgress: (cb) => on('transfer:progress', cb),
  },

  // -- Logs ----------------------------------------------------------------
  log: {
    /** Returns the absolute path to today's log file. */
    getPath: ()       => ipcRenderer.invoke('log:get-path'),
    /** Returns the last n parsed log entries from the file. */
    tail:    (n)      => ipcRenderer.invoke('log:tail', n),
    /** Opens the log file in Explorer. */
    reveal:  ()       => ipcRenderer.invoke('log:reveal'),
    /** Subscribe to live log entries pushed from the main process. */
    onEntry: (cb)     => on('log:entry', cb),
  },

  // -- SSH utilities -------------------------------------------------------
  ssh: {
    /** Test an SFTP connection. Returns { ok: true } or { ok: false, error: string }. */
    test: (cfg) => ipcRenderer.invoke('ssh:test', cfg),
    /** Scan ~/.ssh/config (and WSL equivalents). Returns array of host entries. */
    scanConfigs: () => ipcRenderer.invoke('ssh:scan-configs'),
    /** List a remote directory. Returns { ok, entries: [{ name, type }] } or { ok: false, error }. */
    listDir: (cfg) => ipcRenderer.invoke('ssh:list-dir', cfg),
  },

  // -- Backup (NAS → local) ------------------------------------------------
  backup: {
    /** Run a backup pull. cfg = { sftp, sources, localDest }. Returns { ok, stats }. */
    run:    (cfg) => ipcRenderer.invoke('backup:run', cfg),
    /** Abort the running backup at the next file boundary. */
    cancel: ()    => ipcRenderer.invoke('backup:cancel'),
    /**
     * Subscribe to per-file progress during a backup run.
     * Payload: { file, status, stats: { files, skipped, bytes, errors[] } }
     * @returns {() => void} unsubscribe
     */
    onProgress: (cb) => on('backup:progress', cb),
  },

  // -- Local filesystem ----------------------------------------------------
  local: {
    /** Wipes all contents of a folder then recreates it empty. */
    clearFolder: (path) => ipcRenderer.invoke('local:clear-folder', path),
  },

  // -- Remote browser ------------------------------------------------------
  remote: {
    /**
     * List a remote directory via SFTP.
     * Returns { ok: true, entries: [{ name, type, size, modified }] } or { ok: false, error }.
     */
    list: (cfg, path) => ipcRenderer.invoke('remote:list', cfg, path),
    /**
     * Recursively create local directories mirroring a remote folder structure.
     * Returns { ok: true, created: string[] } or { ok: false, error }.
     */
    checkout: (cfg, remotePath, localRoot) =>
      ipcRenderer.invoke('remote:checkout', cfg, remotePath, localRoot),
    /**
     * Read a remote file as UTF-8 text.
     * Returns { ok: true, content: string } or { ok: false, error }.
     */
    readFile: (cfg, path) => ipcRenderer.invoke('remote:read-file', cfg, path),
    /**
     * Write UTF-8 text content to a remote file.
     * Returns { ok: true } or { ok: false, error }.
     */
    writeFile: (cfg, path, content) => ipcRenderer.invoke('remote:write-file', cfg, path, content),
    /**
     * Delete a remote file or directory tree.
     * Returns { ok: true } or { ok: false, error }.
     */
    delete: (cfg, path, isDir) => ipcRenderer.invoke('remote:delete', cfg, path, isDir),
    /**
     * Move / rename a remote path via SFTP rename.
     * Returns { ok: true } or { ok: false, error }.
     */
    move: (cfg, src, dst) => ipcRenderer.invoke('remote:move', cfg, src, dst),
    /**
     * Walk localFolder, stat each file against cfg.remotePath on NAS,
     * delete locally if found. Returns { ok, total, cleaned, notFound[], errors[] }.
     */
    verifyClean: (cfg, localFolder) => ipcRenderer.invoke('remote:verify-clean', cfg, localFolder),
  },
})
