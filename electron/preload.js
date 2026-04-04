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

  // -- Thumbnail cache -----------------------------------------------------
  cache: {
    /** Returns the total size of the thumbnail cache in bytes. */
    thumbSize:   () => ipcRenderer.invoke('cache:thumb-size'),
    /** Delete all cached thumbnails. */
    clearThumbs: () => ipcRenderer.invoke('cache:clear-thumbs'),
  },

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
  /** Opens a save dialog (for files) or folder picker (for dirs). Resolves to chosen path or null. */
  selectDownloadPath: (defaultName, isDir) => ipcRenderer.invoke('dialog:select-download-path', defaultName, isDir),

  // -- Watcher -------------------------------------------------------------
  watcher: {
    /** Start the watcher for a specific connection by connectionId. */
    start:     (connectionId) => ipcRenderer.invoke('watcher:start', connectionId),
    /** Stop the watcher for a specific connection by connectionId. */
    stop:      (connectionId) => ipcRenderer.invoke('watcher:stop', connectionId),
    /** Returns the full watcher state map keyed by connectionId. */
    list:      ()             => ipcRenderer.invoke('watcher:list'),
    /** Stop all watchers and pause the worker (global kill switch). */
    pauseAll:  ()             => ipcRenderer.invoke('watcher:pause-all'),
    /** Restart watchers that were running before pauseAll and resume the worker. */
    resumeAll: ()             => ipcRenderer.invoke('watcher:resume-all'),

    /**
     * Subscribe to watcher status events.
     * Payload is the full map: Record<connectionId, { watching, folder, state, file }>.
     * @param {(statuses: Record<string, { watching: boolean, folder: string|null, state: string|null, file: string|null }>) => void} cb
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
    clearDone:   ()      => ipcRenderer.invoke('queue:clear-done'),
    /** Removes PENDING and ERROR jobs whose source file no longer exists on disk. */
    clearStale:  ()      => ipcRenderer.invoke('queue:clear-stale'),
    /** Enqueue a batch of files (relative paths) from a local folder for a specific connection. */
    enqueueBatch: (connectionId, localFolder, relPaths) => ipcRenderer.invoke('queue:enqueue-batch', connectionId, localFolder, relPaths),
    /** Cancel a PENDING job (removes it) or a TRANSFERRING job (marks it ERROR). */
    cancel: (jobId) => ipcRenderer.invoke('queue:cancel', jobId),
    /** Pause the transfer worker — no new jobs dequeued until resume. */
    pause:  () => ipcRenderer.invoke('queue:pause'),
    /** Resume the transfer worker. */
    resume: () => ipcRenderer.invoke('queue:resume'),

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
    /** Truncate today's log file. */
    clear:   ()       => ipcRenderer.invoke('log:clear'),
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

  // -- Updates --------------------------------------------------------------
  update: {
    /** Manually trigger an update check. Returns { ok, version? } or { ok: false, error }. */
    check:   () => ipcRenderer.invoke('update:check'),
    /** Quit and install a downloaded update. */
    install: () => ipcRenderer.invoke('update:install'),
    /** Subscribe to update status events from the main process.
     *  Payload: { status: 'checking'|'available'|'downloading'|'ready'|'up-to-date'|'error', version?, percent?, error? }
     *  @returns {() => void} unsubscribe */
    onStatus: (cb) => on('update:status', cb),
  },

  // -- Local filesystem ----------------------------------------------------
  local: {
    /** Wipes all contents of a folder then recreates it empty. */
    clearFolder: (path) => ipcRenderer.invoke('local:clear-folder', path),
  },

  // -- Remote browser ------------------------------------------------------
  remote: {
    /** List a remote directory via SFTP (pooled connection). */
    list: (connectionId, path) => ipcRenderer.invoke('remote:list', connectionId, path),
    /** Recursively create local directories mirroring a remote folder structure. */
    checkout: (connectionId, remotePath, localRoot) =>
      ipcRenderer.invoke('remote:checkout', connectionId, remotePath, localRoot),
    /** Download a remote file or folder to a local path chosen via save dialog. */
    download: (connectionId, remotePath, localPath, isDir) =>
      ipcRenderer.invoke('remote:download', connectionId, remotePath, localPath, isDir),
    /** Read a remote file as UTF-8 text. */
    readFile: (connectionId, path) => ipcRenderer.invoke('remote:read-file', connectionId, path),
    /** Write UTF-8 text content to a remote file. */
    writeFile: (connectionId, path, content) => ipcRenderer.invoke('remote:write-file', connectionId, path, content),
    /** Delete a remote file or directory tree. */
    delete: (connectionId, path, isDir) => ipcRenderer.invoke('remote:delete', connectionId, path, isDir),
    /** Move / rename a remote path via SFTP rename. */
    move: (connectionId, src, dst) => ipcRenderer.invoke('remote:move', connectionId, src, dst),
    /** Create a remote directory. */
    mkdir: (connectionId, path) => ipcRenderer.invoke('remote:mkdir', connectionId, path),
    /** Walk localFolder, stat each file against remote. No deletion — check only. */
    verifyClean: (connectionId, localFolder) => ipcRenderer.invoke('remote:verify-clean', connectionId, localFolder),
    /** Delete a list of local files (by relative path) inside localFolder. */
    verifyDelete: (localFolder, relPaths) => ipcRenderer.invoke('remote:verify-delete', localFolder, relPaths),
    /** Subscribe to download progress events. Payload: { connectionId, name, filesProcessed, totalFiles, bytesTransferred, totalBytes } */
    onDownloadProgress: (cb) => on('download:progress', cb),
    /** Get filesystem disk usage stats for a remote connection. Returns { ok, total, used, free } in bytes. */
    diskUsage: (connectionId) => ipcRenderer.invoke('remote:disk-usage', connectionId),
    /** Start a recursive folder-size scan. Results stream via size:* push events. */
    sizeScan:   (connectionId) => ipcRenderer.invoke('remote:size-scan', connectionId),
    /** Cancel an in-progress size scan. */
    sizeCancel: (connectionId) => ipcRenderer.invoke('remote:size-cancel', connectionId),
    /** Subscribe to scan progress ticks. Payload: { connectionId, path, count, elapsedMs } */
    onSizeProgress: (cb) => on('size:progress', cb),
    /** Subscribe to per-level scan results. Payload: { connectionId, parentPath, entries: [{name,path,sizeKb}] } */
    onSizeLevel: (cb) => on('size:level', cb),
    /** Subscribe to scan-complete event. Payload: { connectionId, totalFolders, elapsedMs } */
    onSizeDone:  (cb) => on('size:done', cb),
    /** Subscribe to scan error event. Payload: { connectionId, error } */
    onSizeError: (cb) => on('size:error', cb),
    /** Load persisted scan result for a connection. Returns { tree, scanMeta } or null. */
    sizeLoadCache: (connectionId) => ipcRenderer.invoke('size:load-cache', connectionId),
    /** Persist scan result for a connection. */
    sizeSaveCache: (connectionId, data) => ipcRenderer.invoke('size:save-cache', connectionId, data),
  },
})
