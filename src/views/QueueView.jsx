import { useState, useEffect, useRef, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUp, ArrowDown } from 'lucide-react'
import Badge from '../components/ui/Badge'
import ProgressBar from '../components/ui/ProgressBar'
import styles from './QueueView.module.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROW_HEIGHT = 48

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
const columns = [
  {
    accessorKey: 'filename',
    header: 'File',
    size: 300,
    minSize: 100,
    cell: ({ getValue, row }) => {
      const srcPath = row.original.srcPath ?? ''
      const dir = srcPath.replace(/[/\\][^/\\]+$/, '')
      return (
        <div className={styles.fileCell}>
          <span className={styles.filename}>{getValue()}</span>
          {dir && <span className={styles.filepath}>{dir}</span>}
          {row.original.errorMsg && (
            <span className={styles.errorMsg}>{row.original.errorMsg}</span>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 116,
    minSize: 80,
    cell: ({ getValue }) => <Badge status={getValue()} />,
  },
  {
    accessorKey: 'progress',
    header: 'Progress',
    size: 160,
    minSize: 80,
    // Sort by status priority: Transferring → Pending → Done → Error
    sortingFn: (rowA, rowB) => {
      const pri = { TRANSFERRING: 0, PENDING: 1, DONE: 2, ERROR: 3 }
      const a = pri[rowA.original.status] ?? 4
      const b = pri[rowB.original.status] ?? 4
      if (a !== b) return a - b
      // Same status: sort by progress descending
      return rowB.original.progress - rowA.original.progress
    },
    cell: ({ getValue, row }) =>
      ['TRANSFERRING', 'DONE', 'ERROR'].includes(row.original.status) ? (
        <ProgressBar percent={getValue() * 100} status={row.original.status} />
      ) : null,
  },
  {
    accessorKey: 'createdAt',
    header: 'Added',
    size: 80,
    minSize: 60,
    cell: ({ getValue }) => (
      <span className={styles.time}>{relativeTime(getValue())}</span>
    ),
  },
  {
    id: 'actions',
    header: '',
    size: 72,
    minSize: 60,
    enableSorting: false,
    enableResizing: false,
    cell: ({ row }) =>
      row.original.status === 'ERROR' ? (
        <button
          className={styles.retryBtn}
          onClick={() => window.winraid?.queue.retry(row.original.id)}
        >
          Retry
        </button>
      ) : null,
  },
]

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function QueueView() {
  const [jobs, setJobs]       = useState([])
  const [sorting, setSorting] = useState([{ id: 'createdAt', desc: true }])
  const scrollRef = useRef(null)

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

  // ---------------------------------------------------------------------------
  // Table
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: jobs,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
  })

  const { rows }  = table.getRowModel()
  const totalCols = table.getCenterTotalSize()

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize    = virtualizer.getTotalSize()
  const doneCount    = jobs.filter((j) => j.status === 'DONE').length

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className={styles.container}>

      {/* View header */}
      <div className={styles.header}>
        <span className={styles.title}>
          Queue
          {jobs.length > 0 && <span className={styles.count}>{jobs.length}</span>}
        </span>
        <div className={styles.headerActions}>
          {doneCount > 0 && (
            <button
              className={styles.clearBtn}
              onClick={() => window.winraid?.queue.clearDone()}
            >
              Clear done ({doneCount})
            </button>
          )}
        </div>
      </div>

      {/* Single scroll container — handles both axes; thead is sticky inside */}
      <div ref={scrollRef} className={styles.scrollWrapper}>

        {/* Column headers */}
        {table.getHeaderGroups().map((hg) => (
          <div key={hg.id} className={styles.thead} style={{ width: totalCols, minWidth: '100%' }}>
            {hg.headers.map((header) => {
              const canSort   = header.column.getCanSort()
              const sortDir   = header.column.getIsSorted()
              const canResize = header.column.getCanResize()
              return (
                <div
                  key={header.id}
                  className={[styles.th, canSort ? styles.thSortable : null].filter(Boolean).join(' ')}
                  style={{ width: header.getSize(), flexShrink: 0 }}
                  onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                >
                  <span className={styles.thLabel}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </span>
                  {canSort && sortDir && (
                    <span className={styles.sortIcon}>
                      {sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                    </span>
                  )}
                  {canResize && (
                    <div
                      className={[styles.resizeHandle, header.column.getIsResizing() ? styles.resizing : null].filter(Boolean).join(' ')}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {/* Virtual body */}
        {jobs.length === 0 ? (
          <div className={styles.empty}>
            No transfers yet — add a watch folder in Settings.
          </div>
        ) : (
          <div style={{ height: totalSize, position: 'relative', width: totalCols, minWidth: '100%' }}>
            {virtualItems.map((vItem) => {
              const row = rows[vItem.index]
              return (
                <div
                  key={row.id}
                  className={styles.tr}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                    height: vItem.size,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      className={styles.td}
                      style={{ width: cell.column.getSize(), flexShrink: 0 }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}

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
