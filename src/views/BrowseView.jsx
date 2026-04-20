import { useState, useEffect } from 'react'
import {
  ChevronRight, HardDrive, Download, RefreshCw,
  AlertCircle, AlertTriangle, Loader, FolderPlus, List, LayoutGrid,
  Trash2, FolderInput, X as XIcon,
} from 'lucide-react'
import styles from './BrowseView.module.css'
import { formatSize } from '../utils/format'
import EditorModal from '../components/EditorModal'
import QuickLookOverlay from '../components/QuickLookOverlay'
import DeleteModal from '../components/modals/DeleteModal'
import MoveModal from '../components/modals/MoveModal'
import ConfirmModal from '../components/modals/ConfirmModal'
import BulkDeleteModal from '../components/modals/BulkDeleteModal'
import BulkMoveModal from '../components/modals/BulkMoveModal'
import BrowseList from './BrowseList'
import BrowseGrid from './BrowseGrid'
import Tooltip from '../components/ui/Tooltip'
import { useBrowse } from '../hooks/useBrowse'

export default function BrowseView({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connections: connectionsProp, connectionId, style }) {
  const browse = useBrowse({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connectionsProp, connectionId })
  const {
    connections, selectedId, path, entries, loading, error, status,
    confirmTarget, editingFile, deleteTarget, moveTarget,
    viewMode, selectedFile, showQuickLook,
    dragSource, dragSourcePaths, moveInFlight, downloadProgress,
    selected, bulkAction, bulkMoveDest,
    setEditingFile, setViewMode, setNewFolderName, setConfirmTarget,
    setDeleteTarget, setMoveTarget, setBulkAction, setBulkMoveDest,
    setSelectedFile, setShowQuickLook,
    cfgRemotePath, localFolder, crumbs,
    fileEntries, selectedEntries, dirCount, fileCount, busy, noConfig,
    fetchDir, navigate,
    handleCheckout, handleConfirm,
    handleDownload,
    handleDelete, handleMove,
    handleBulkDelete, handleBulkMove, handleBulkCheckout, clearSelection,
    handleDragOverFolder, handleDragLeaveFolder, handleDrop,
    handleItemPointer, toggleSelectAll,
    handleRubberBandStart, handleRubberBandMove, handleRubberBandEnd, rubberBand,
    externalDropActive,
    mergerfsWarning,
    handleExternalDragEnter,
    handleExternalDragOver,
    handleExternalDragLeave,
    handleExternalDrop,
  } = browse

  const sftpCfg = (connections ?? []).find((c) => c.id === selectedId)?.sftp ?? null

  const [diskUsage, setDiskUsage] = useState(null)

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setDiskUsage(null)
    window.winraid?.remote.diskUsage?.(selectedId)
      ?.then((res) => { if (!cancelled) setDiskUsage(res) })
      ?.catch(() => {})
    return () => { cancelled = true }
  }, [selectedId])

  return (
    <div
      className={styles.container}
      style={style}
      data-testid="browse-container"
      onDragEnter={handleExternalDragEnter}
      onDragOver={handleExternalDragOver}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
    >


      {editingFile && (
        <EditorModal connectionId={selectedId} filePath={editingFile} onClose={() => setEditingFile(null)} />
      )}
      {showQuickLook && selectedFile && (
        <QuickLookOverlay
          file={selectedFile}
          connectionId={selectedId}
          remoteBasePath={cfgRemotePath}
          files={fileEntries}
          onNavigate={(f) => {
            setSelectedFile(f)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: f, connectionId: selectedId })
          }}
          onClose={() => {
            setShowQuickLook(false)
            setSelectedFile(null)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: null, connectionId: selectedId })
          }}
          onDelete={(target) => {
            setShowQuickLook(false)
            setSelectedFile(null)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: null, connectionId: selectedId })
            setDeleteTarget(target)
          }}
        />
      )}
      {confirmTarget && (
        <ConfirmModal
          remotePath={confirmTarget}
          cfgRemotePath={cfgRemotePath}
          localFolder={localFolder}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          target={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {moveTarget && (
        <MoveModal
          target={moveTarget}
          sftpCfg={sftpCfg}
          onConfirm={handleMove}
          onCancel={() => setMoveTarget(null)}
        />
      )}
      {bulkAction === 'delete' && (
        <BulkDeleteModal
          count={selected.size}
          names={selectedEntries.map((e) => e.name)}
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkAction(null)}
        />
      )}
      {bulkAction === 'move' && (
        <BulkMoveModal
          count={selected.size}
          names={selectedEntries.map((e) => e.name)}
          dest={bulkMoveDest}
          onDestChange={setBulkMoveDest}
          onConfirm={handleBulkMove}
          onCancel={() => { setBulkAction(null); setBulkMoveDest('') }}
          currentPath={path}
          sftpCfg={sftpCfg}
        />
      )}

      {moveInFlight && (
        <div className={styles.moveOverlay}>
          <Loader size={24} className={styles.spinning} />
          <span className={styles.moveOverlayText}>Moving {moveInFlight}</span>
        </div>
      )}

      {downloadProgress && (
        <div className={styles.moveOverlay}>
          <Loader size={24} className={styles.spinning} />
          <span className={styles.moveOverlayText}>
            {downloadProgress.totalFiles > 1
              ? `Downloading ${downloadProgress.name}... ${downloadProgress.filesProcessed} / ${downloadProgress.totalFiles} files`
              : `Downloading ${downloadProgress.name}...${downloadProgress.totalBytes > 0 ? ` ${Math.round((downloadProgress.bytesTransferred / downloadProgress.totalBytes) * 100)}%` : ''}`
            }
          </span>
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            className={styles.newFolderBtn}
            onClick={() => setNewFolderName('')}
            disabled={busy || loading || noConfig || mergerfsWarning}
          >
            <FolderPlus size={13} />
            New Folder
          </button>
          <Tooltip tip={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'} side="bottom">
            <button
              className={styles.viewToggleBtn}
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            >
              {viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
            </button>
          </Tooltip>
          <Tooltip tip="Refresh" side="bottom">
            <button
              className={styles.refreshBtn}
              onClick={() => fetchDir(path)}
              disabled={loading || noConfig}
            >
              <RefreshCw size={13} className={loading ? styles.spinning : ''} />
            </button>
          </Tooltip>
        </div>

        <div className={styles.headerRight}>
          {!noConfig && (
            <>
              {cfgRemotePath && path !== cfgRemotePath && (
                <Tooltip tip={`Jump to sync root: ${cfgRemotePath}`} side="bottom">
                  <button
                    className={styles.goRootBtn}
                    onClick={() => navigate(cfgRemotePath)}
                    disabled={loading}
                  >
                    &uarr; Go to root
                  </button>
                </Tooltip>
              )}
              {localFolder && (
                <Tooltip tip={`Check out current folder structure to ${localFolder}`} side="bottom">
                  <button
                    className={styles.checkoutBtn}
                    onClick={() => handleCheckout(path)}
                    disabled={busy || loading}
                  >
                    <Download size={13} />
                    Check out here
                  </button>
                </Tooltip>
              )}
            </>
          )}
        </div>
      </div>

      {connections.length === 0 ? (
        <div className={styles.emptyState}>
          <AlertCircle size={28} />
          <span>No connections configured. Add one in Connections.</span>
        </div>
      ) : noConfig ? (
        <div className={styles.emptyState}>
          <AlertCircle size={28} />
          <span>Selected connection has no host configured.</span>
        </div>
      ) : (
        <>
          {/* Breadcrumb */}
          <div className={styles.breadcrumb}>
            {crumbs.map((c, i) => (
              <span key={c.path} className={styles.crumbGroup}>
                {i > 0 && <ChevronRight size={11} className={styles.crumbSep} />}
                <button
                  className={[
                    styles.crumb,
                    c.path === path ? styles.crumbActive : '',
                  ].join(' ')}
                  onClick={() => c.path !== path && navigate(c.path)}
                  disabled={c.path === path && !dragSource}
                  onDragOver={(e) => handleDragOverFolder(e, c.path)}
                  onDragLeave={handleDragLeaveFolder}
                  onDrop={(e) => handleDrop(e, c.path)}
                >
                  {i === 0 ? <HardDrive size={11} /> : c.label}
                </button>
              </span>
            ))}
          </div>

          {mergerfsWarning && (
            <div className={styles.mergerfsWarning}>
              <AlertTriangle size={13} />
              This directory is a mergerfs union mount — files cannot be uploaded or created here. Navigate into a share folder.
            </div>
          )}

          {status && (
            <div className={[styles.statusFlash, status.ok ? styles.statusOk : styles.statusErr].join(' ')}>
              {status.msg}
            </div>
          )}

          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={13} />
              {error}
            </div>
          )}

          <div className={styles.listArea}>
            {externalDropActive && (
              <div className={styles.dropOverlay}>
                <div className={styles.dropStack}>
                  <div className={styles.dropCard} />
                  <div className={styles.dropCard} />
                  <div className={styles.dropCard} />
                </div>
                <span className={styles.dropOverlayLabel}>Drop to upload to {path}</span>
              </div>
            )}
          {viewMode === 'list' && (
            <BrowseList
              entriesWithPaths={browse.entriesWithPaths}
              loading={browse.loading}
              error={browse.error}
              newFolderName={browse.newFolderName}
              setNewFolderName={browse.setNewFolderName}
              handleCreateFolder={browse.handleCreateFolder}
              path={browse.path}
              selectedId={browse.selectedId}
              busy={browse.busy}
              selected={browse.selected}
              dragSourcePaths={dragSourcePaths}
              lastVisitedDir={browse.lastVisitedDir}
              highlightFile={browse.highlightFile}
              highlightRef={browse.highlightRef}
              handleDragStart={browse.handleDragStart}
              handleDragEnd={browse.handleDragEnd}
              handleDragOverFolder={browse.handleDragOverFolder}
              handleDragLeaveFolder={browse.handleDragLeaveFolder}
              handleDrop={browse.handleDrop}
              navigate={browse.navigate}
              openQuickLook={browse.openQuickLook}
              handleItemPointer={handleItemPointer}
              toggleSelectAll={toggleSelectAll}
              handleDownload={handleDownload}
              setEditingFile={browse.setEditingFile}
              setMoveTarget={browse.setMoveTarget}
              setDeleteTarget={browse.setDeleteTarget}
            />
          )}
          {viewMode === 'grid' && (
            <BrowseGrid
              entriesWithPaths={browse.entriesWithPaths}
              loading={browse.loading}
              error={browse.error}
              newFolderName={browse.newFolderName}
              setNewFolderName={browse.setNewFolderName}
              handleCreateFolder={browse.handleCreateFolder}
              path={browse.path}
              selectedId={browse.selectedId}
              busy={browse.busy}
              selected={browse.selected}
              dragSourcePaths={dragSourcePaths}
              lastVisitedDir={browse.lastVisitedDir}
              highlightFile={browse.highlightFile}
              highlightRef={browse.highlightRef}
              handleDragStart={browse.handleDragStart}
              handleDragEnd={browse.handleDragEnd}
              handleDragOverFolder={browse.handleDragOverFolder}
              handleDragLeaveFolder={browse.handleDragLeaveFolder}
              handleDrop={browse.handleDrop}
              navigate={browse.navigate}
              openQuickLook={browse.openQuickLook}
              handleItemPointer={handleItemPointer}
              toggleSelectAll={toggleSelectAll}
              handleRubberBandStart={handleRubberBandStart}
              handleRubberBandMove={handleRubberBandMove}
              handleRubberBandEnd={handleRubberBandEnd}
              rubberBand={rubberBand}
              handleDownload={handleDownload}
              setEditingFile={browse.setEditingFile}
              setMoveTarget={browse.setMoveTarget}
              setDeleteTarget={browse.setDeleteTarget}
            />
          )}
          </div>

          {/* Entry count bar */}
          {!loading && !error && entries.length > 0 && (
            <div className={styles.countBar}>
              {dirCount  > 0 && <span>{dirCount}  {dirCount  === 1 ? 'folder' : 'folders'}</span>}
              {fileCount > 0 && <span>{fileCount} {fileCount === 1 ? 'file'   : 'files'}</span>}
              {dirCount  > 0 && fileCount > 0 && <span className={styles.countTotal}>{entries.length} total</span>}
              {diskUsage?.ok && (
                <span className={styles.diskPill}>
                  {formatSize(diskUsage.free)} free of {formatSize(diskUsage.total)}
                </span>
              )}
            </div>
          )}

          {/* Bulk action drawer */}
          <div className={[styles.bulkBar, selected.size > 0 ? styles.bulkBarOpen : ''].join(' ')}>
            <span className={styles.bulkCount}>
              {selected.size} selected
            </span>
            <div className={styles.bulkActions}>
              <Tooltip tip="Download selected" side="top">
                <button className={styles.bulkBtn} onClick={handleBulkCheckout} disabled={busy}>
                  <Download size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Move selected" side="top">
                <button
                  className={styles.bulkBtn}
                  onClick={() => { setBulkAction('move'); setBulkMoveDest(path) }}
                  disabled={busy}
                >
                  <FolderInput size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Delete selected" side="top">
                <button
                  className={[styles.bulkBtn, styles.bulkBtnDanger].join(' ')}
                  onClick={() => setBulkAction('delete')}
                  disabled={busy}
                >
                  <Trash2 size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Clear selection" side="top">
                <button className={styles.bulkBtn} onClick={clearSelection}>
                  <XIcon size={13} />
                </button>
              </Tooltip>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
