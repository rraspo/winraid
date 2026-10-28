import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import Button from './ui/Button'
import ProgressBar from './ui/ProgressBar'
import { formatSize } from '../utils/format'
import styles from './DownloadsPanel.module.css'

// How long a finished or canceled download stays on screen; a failed one
// stays until dismissed, so its reason is not missed.
const CLEAR_AFTER_MS = 8000

// Downloads run as background jobs in the main process (electron/downloads.js).
// This panel is mounted once at the app root, so a job keeps showing its
// progress whichever screen is open, and the rest of the app stays usable.
export default function DownloadsPanel() {
  const [jobs, setJobs] = useState([])
  const clearTimers = useRef(new Map())

  useEffect(() => {
    const downloads = window.winraid?.downloads
    if (!downloads) return
    const upsert = (snapshot) => setJobs((prev) => {
      const index = prev.findIndex((job) => job.id === snapshot.id)
      if (index === -1) return [...prev, snapshot]
      const next = [...prev]
      next[index] = snapshot
      return next
    })
    downloads.list().then((list) => list.forEach(upsert)).catch(() => {})
    return downloads.onUpdate(upsert)
  }, [])

  const dismiss = (id) => {
    clearTimeout(clearTimers.current.get(id))
    clearTimers.current.delete(id)
    window.winraid?.downloads.dismiss(id)
    setJobs((prev) => prev.filter((job) => job.id !== id))
  }

  // Schedule the clearing of finished and canceled jobs once each.
  useEffect(() => {
    for (const job of jobs) {
      if ((job.state === 'done' || job.state === 'canceled') && !clearTimers.current.has(job.id)) {
        clearTimers.current.set(job.id, setTimeout(() => dismiss(job.id), CLEAR_AFTER_MS))
      }
    }
  }, [jobs])

  useEffect(() => () => clearTimers.current.forEach((timer) => clearTimeout(timer)), [])

  if (jobs.length === 0) return null

  return (
    <section className={styles.panel} aria-label="Downloads">
      <ul className={styles.list}>
        {jobs.map((job) => (
          <li key={job.id} className={styles.job} aria-label={job.label}>
            <div className={styles.head}>
              <Download size={14} className={styles.icon} aria-hidden="true" />
              <span className={styles.label}>{job.label}</span>
              {job.state === 'running' || job.state === 'preparing' ? (
                <button type="button" className={styles.iconBtn} aria-label="Cancel download" onClick={() => window.winraid?.downloads.cancel(job.id)}>
                  <X size={14} />
                </button>
              ) : (
                <button type="button" className={styles.iconBtn} aria-label="Dismiss" onClick={() => dismiss(job.id)}>
                  <X size={14} />
                </button>
              )}
            </div>
            <JobBody job={job} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function JobBody({ job }) {
  if (job.state === 'preparing') {
    return <p className={styles.detail}>Preparing…</p>
  }
  if (job.state === 'running') {
    const percent = job.bytesTotal > 0 ? (job.bytesDone / job.bytesTotal) * 100 : 0
    const bytes = `${formatSize(job.bytesDone)} of ${formatSize(job.bytesTotal)}`
    return (
      <>
        <ProgressBar percent={percent} status="TRANSFERRING" />
        <p className={styles.detail}>
          {job.filesTotal > 1 ? `${job.filesDone} of ${job.filesTotal} files · ${bytes}` : bytes}
        </p>
        {job.currentFile && job.filesTotal > 1 && <p className={styles.file}>{job.currentFile}</p>}
      </>
    )
  }
  if (job.state === 'done') {
    return (
      <div className={styles.outcome}>
        <p className={styles.detail}>Downloaded to {job.destination}</p>
        <Button size="sm" variant="ghost" onClick={() => window.winraid?.local.reveal(job.destination)}>Show in folder</Button>
      </div>
    )
  }
  if (job.state === 'canceled') {
    return <p className={styles.detail}>Canceled{job.filesDone > 0 ? ` after ${job.filesDone} of ${job.filesTotal} files` : ''}</p>
  }
  return <p role="alert" className={styles.error}>Download failed: {job.error}</p>
}
