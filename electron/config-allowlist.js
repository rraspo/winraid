// Top-level config keys the renderer is allowed to write. A write to
// anything else is refused in main.
//
// This is a security boundary, so it stays a list rather than a pattern. It
// lives in its own module so a test can hold it against what the renderer
// actually writes: a key added to a settings screen but not added here fails
// silently, which is exactly how the default-connection setting shipped
// unable to save.
export const CONFIG_SET_ALLOWLIST = [
  'localFolder', 'operation', 'folderMode', 'extensions', 'ignoredExtensions',
  'backup', 'connections', 'backupByConnection',
  'browse', 'playDefaults', 'snapshot', 'thumbSeek', 'activeConnectionId',
  'favoritesByConnection', 'appearance', 'defaultConnection', 'trashByConnection',
]
