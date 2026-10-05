import { useCallback } from 'react'

// Defaults match today's behavior exactly, so a connection that has never
// touched Options renders identically to before this existed.
const DEFAULT_BROWSE_OPTIONS = {
  thumbnails: true,
  columns: { size: true, modified: true, kind: true },
  density: 'default', // 'compact' | 'default' | 'roomy'
  showHidden: false,
}

// Per-view Browse preferences (thumbnails, column visibility, density,
// hidden files) — genuinely per-connection, so they live on the connection
// record in config.json alongside localFolder/folderMode/favorites rather
// than localStorage. That keeps them on the one write path (config.set
// ('connections', ...)) already allowlisted and already exercised by every
// other per-connection setting, instead of inventing a second, unvalidated
// persistence mechanism next to it.
export function useBrowseOptions({ selectedId, selectedConn, connections, setConnections }) {
  const browseOptions = {
    ...DEFAULT_BROWSE_OPTIONS,
    ...selectedConn?.browseOptions,
    columns: { ...DEFAULT_BROWSE_OPTIONS.columns, ...selectedConn?.browseOptions?.columns },
  }

  const patchBrowseOptions = useCallback((patch) => {
    if (!selectedId) return
    const { columns: columnPatch, ...rest } = patch
    const updatedConns = connections.map((c) => {
      if (c.id !== selectedId) return c
      return {
        ...c,
        browseOptions: {
          ...DEFAULT_BROWSE_OPTIONS,
          ...c.browseOptions,
          ...rest,
          columns: { ...DEFAULT_BROWSE_OPTIONS.columns, ...c.browseOptions?.columns, ...columnPatch },
        },
      }
    })
    setConnections(updatedConns)
    window.winraid?.config.set('connections', updatedConns)
  }, [selectedId, connections, setConnections])

  const setThumbnailsEnabled = useCallback((value) => patchBrowseOptions({ thumbnails: value }), [patchBrowseOptions])
  const setColumnVisible     = useCallback((column, value) => patchBrowseOptions({ columns: { [column]: value } }), [patchBrowseOptions])
  const setDensity           = useCallback((value) => patchBrowseOptions({ density: value }), [patchBrowseOptions])
  const setShowHiddenFiles   = useCallback((value) => patchBrowseOptions({ showHidden: value }), [patchBrowseOptions])

  return { browseOptions, setThumbnailsEnabled, setColumnVisible, setDensity, setShowHiddenFiles }
}
