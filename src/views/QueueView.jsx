import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import { File, Video, Image, FileText, Archive, X, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react'
import Tooltip from '../components/ui/Tooltip'
import styles from './QueueView.module.css'
import { formatSize } from '../utils/format'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v'].includes(ext))
    return <Video size={18} />
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'raw', 'tiff', 'bmp'].includes(ext))
    return <Image size={18} />
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'xlsx', 'csv'].includes(ext))
    return <FileText size={18} />
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext))
    return <Archive size={18} />
  return <File size={18} />
}

const STATUS_META = {
  PENDING:     { label: 'Pending',     cls: 'pending',      pri: 1 },
  TRANSFERRING:{ label: 'Transferring',cls: 'transferring', pri: 0 },
  DONE:        { label: 'Done',        cls: 'done',         pri: 3 },
  ERROR:       { label: 'Error',       cls: 'error',        pri: 2 },
}

const columnHelper = createColumnHelper()

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function QueueView({ connections = [], onBrowsePath, onNavigateLogs }) {
  const [jobs, setJobs] = useState([])
  const [sorting, setSorting] = useState([])
  const [columnSizing, setColumnSizing] = useState({})
  const scrollRef = useRef(null)

  const connMap = useMemo(() => {
    const m = {}
    for (const c of connections) m[c.id] = c.name || c.id.slice(0, 8)
    return m
  }, [connections])

  function handleRowClick(job) {
    if (job.status === 'ERROR') {
      if (onNavigateLogs) onNavigateLogs({ filename: job.filename, errorAt: job.errorAt ?? Date.now() })
      return
    }
    if (!onBrowsePath || !job.connectionId) return
    const conn = connections.find((c) => c.id === job.connectionId)
    if (!conn) return
    const remotePath = conn.sftp?.remotePath || conn.smb?.remotePath || '/'
    const relDir = job.relPath?.replace(/[/\\][^/\\]+$/, '')
    const dest = (conn.folderMode !== 'flat' && relDir && relDir !== job.relPath)
      ? `${remotePath}/${relDir}`.replace(/\/+/g, '/')
      : remotePath
    onBrowsePath(job.connectionId, dest, job.filename)
  }

  const refresh = useCallback(async () => {
    const list = await window.winraid?.queue.list()
    if (list) setJobs(list)
  }, [])

  useEffect(() => {
    refresh()

    const unsubUpdated = window.winraid?.queue.onUpdated((payload) => {
      switch (payload.type) {
        case 'added':
          refresh()
          break
        case 'updated':
          if (payload.job) {
            setJobs((prev) => {
              const idx = prev.findIndex((j) => j.id === payload.job.id)
              if (idx === -1) return [payload.job, ...prev]
              const next = [...prev]
              next[idx] = payload.job
              return next
            })
          }
          break
        case 'cleared':
          setJobs((prev) => prev.filter((j) => j.status !== 'DONE'))
          break
        case 'removed':
          setJobs((prev) => prev.filter((j) => j.id !== payload.jobId))
          break
      }
    })

    const unsubProgress = window.winraid?.queue.onProgress(({ jobId, percent }) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, progress: percent / 100, status: 'TRANSFERRING' } : j
        )
      )
    })

    return () => {
      unsubUpdated?.()
      unsubProgress?.()
    }
  }, [refresh])

  // Default sort: active first, then pending, done, error
  const sorted = useMemo(() => {
    if (sorting.length > 0) return jobs
    return [...jobs].sort((a, b) => {
      const priA = STATUS_META[a.status]?.pri ?? 4
      const priB = STATUS_META[b.status]?.pri ?? 4
      return priA - priB
    })
  }, [jobs, sorting])

  const columns = useMemo(() => [
    columnHelper.display({
      id: 'icon',
      size: 32,
      minSize: 32,
      maxSize: 32,
      enableResizing: false,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => (
        <div className={styles.fileIconWrap}>
          {getFileIcon(row.original.filename)}
        </div>
      ),
    }),
    columnHelper.accessor('filename', {
      id: 'file',
      header: 'File / Path',
      size: 200,
      minSize: 120,
      enableResizing: true,
      sortingFn: 'alphanumeric',
      cell: ({ row }) => {
        const { filename, srcPath, errorMsg, status, progress } = row.original
        const dir = srcPath ? srcPath.replace(/[/\\][^/\\]+$/, '') : ''
        const isActive = status === 'TRANSFERRING'
        const percent = Math.round((progress ?? 0) * 100)
        return (
          <div className={styles.fileInfo}>
            <Tooltip tip={filename} side="bottom" onlyWhenTruncated>
              <span className={styles.filename}>{filename}</span>
            </Tooltip>
            {dir && (
              <Tooltip tip={dir} side="bottom" onlyWhenTruncated>
                <span className={styles.filepath}>{dir}</span>
              </Tooltip>
            )}
            {errorMsg && <span className={styles.errorMsg}>{errorMsg}</span>}
            {isActive && (
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor('connectionId', {
      id: 'connection',
      header: 'Connection',
      size: 120,
      minSize: 60,
      enableResizing: true,
      sortingFn: (rowA, rowB) => {
        const a = connMap[rowA.original.connectionId] ?? ''
        const b = connMap[rowB.original.connectionId] ?? ''
        return a.localeCompare(b)
      },
      cell: ({ row }) => {
        const name = connMap[row.original.connectionId] ?? null
        return (
          <div className={styles.connCell}>
            {name && <span className={styles.connTag}>{name}</span>}
          </div>
        )
      },
    }),
    columnHelper.accessor('status', {
      id: 'status',
      header: () => <span style={{ width: '100%', textAlign: 'center' }}>Status</span>,
      size: 96,
      minSize: 70,
      enableResizing: true,
      sortingFn: (rowA, rowB) => {
        const priA = STATUS_META[rowA.original.status]?.pri ?? 4
        const priB = STATUS_META[rowB.original.status]?.pri ?? 4
        return priA - priB
      },
      cell: ({ row }) => {
        const { status, progress } = row.original
        const meta = STATUS_META[status] ?? STATUS_META.PENDING
        const isActive = status === 'TRANSFERRING'
        const percent = Math.round((progress ?? 0) * 100)
        return (
          <div className={styles.statusCell}>
            <span className={[styles.statusBadge, styles[`status_${meta.cls}`]].join(' ')}>
              {isActive ? `${percent}%` : meta.label}
            </span>
          </div>
        )
      },
    }),
    columnHelper.accessor('size', {
      id: 'size',
      header: () => <span style={{ width: '100%', textAlign: 'right', paddingRight: 'var(--space-2)' }}>Size</span>,
      size: 80,
      minSize: 50,
      enableResizing: true,
      sortingFn: 'basic',
      cell: ({ row }) => (
        <div className={styles.sizeCell}>{formatSize(row.original.size)}</div>
      ),
    }),
    columnHelper.accessor('createdAt', {
      id: 'added',
      header: () => <span style={{ width: '100%', textAlign: 'right', paddingRight: 'var(--space-2)' }}>Added</span>,
      size: 70,
      minSize: 50,
      enableResizing: true,
      sortingFn: 'basic',
      cell: ({ row }) => (
        <div className={styles.timeCell}>{relativeTime(row.original.createdAt)}</div>
      ),
    }),
    columnHelper.display({
      id: 'actions',
      size: 64,
      minSize: 64,
      maxSize: 64,
      enableResizing: false,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const { id, status } = row.original
        return (
          <div className={styles.actionsCell}>
            {status === 'ERROR' && (
              <>
                <Tooltip tip="Retry" side="bottom">
                  <button className={styles.retryBtn} onClick={() => window.winraid?.queue.retry(id)}>
                    <RotateCcw size={13} />
                  </button>
                </Tooltip>
                <Tooltip tip="Remove" side="bottom">
                  <button className={styles.removeBtn} onClick={() => window.winraid?.queue.remove(id)}>
                    <X size={13} />
                  </button>
                </Tooltip>
              </>
            )}
            {(status === 'PENDING' || status === 'TRANSFERRING') && (
              <Tooltip tip="Cancel" side="bottom">
                <button className={styles.cancelBtn} onClick={() => window.winraid?.queue.cancel(id)}>
                  <X size={13} />
                </button>
              </Tooltip>
            )}
          </div>
        )
      },
    }),
  ], [connMap])

  const table = useReactTable({
    data: sorted,
    columns,
    state: { sorting, columnSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
  })

  const doneCount = jobs.filter((j) => j.status === 'DONE').length
  const pendingCount = jobs.filter((j) => j.status === 'PENDING' || j.status === 'TRANSFERRING').length

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Transfer Queue</span>
          {pendingCount > 0 && (
            <span className={styles.countBadge}>{pendingCount} pending</span>
          )}
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.clearBtn}
            onClick={() => window.winraid?.queue.clearStale()}
          >
            Clear stale
          </button>
          {doneCount > 0 && (
            <button
              className={styles.clearBtn}
              onClick={() => window.winraid?.queue.clearDone()}
            >
              Clear {doneCount} done
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div ref={scrollRef} className={styles.list}>
        {/* Column headers — inside scrollable list so they scroll horizontally in sync */}
        {jobs.length > 0 && (
          <div className={styles.colHeader}>
            {table.getHeaderGroups().map((hg) =>
              hg.headers.map((header) => {
                const isFlex = header.id === 'file'
                return (
                  <div
                    key={header.id}
                    className={[
                      styles.colHeaderCell,
                      header.column.getCanSort() ? styles.colSortable : '',
                    ].join(' ')}
                    style={isFlex ? { flex: 1, minWidth: 0, overflow: 'hidden' } : { width: header.getSize(), flexShrink: 0 }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' && <ArrowUp size={11} className={styles.sortIcon} />}
                    {header.column.getIsSorted() === 'desc' && <ArrowDown size={11} className={styles.sortIcon} />}
                    {header.column.getCanResize() && (
                      <div
                        className={[styles.resizer, header.column.getIsResizing() ? styles.resizerActive : ''].join(' ')}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
        {jobs.length === 0 ? (
          <div className={styles.empty}>
            <File size={32} strokeWidth={1} className={styles.emptyIcon} />
            <span>No transfers yet</span>
            <span className={styles.emptyHint}>Add a connection with a watch folder to get started.</span>
          </div>
        ) : (
          table.getRowModel().rows.map((row) => {
            const isActive = row.original.status === 'TRANSFERRING'
            return (
              <div
                key={row.id}
                className={[styles.row, isActive ? styles.rowActive : ''].join(' ')}
                onClick={() => handleRowClick(row.original)}
                style={{ cursor: 'pointer' }}
              >
                {row.getVisibleCells().map((cell) => {
                  const isFlex = cell.column.id === 'file'
                  return (
                    <div
                      key={cell.id}
                      style={isFlex ? { flex: 1, minWidth: 0, overflow: 'hidden' } : { width: cell.column.getSize(), flexShrink: 0 }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
