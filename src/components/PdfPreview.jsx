import { useEffect, useRef, useState } from 'react'
import { UnfoldHorizontal, UnfoldVertical } from 'lucide-react'
import SegmentedControl from './ui/SegmentedControl'
import { pageCssWidth } from '../utils/pdfFit'
import { openPdf } from '../utils/pdfjsLoader'
import { describePdfError } from '../utils/pdfError'
import styles from './PdfPreview.module.css'

const FIT_OPTIONS = [
  { value: 'width', label: <><UnfoldHorizontal size={14} aria-hidden="true" /> Fit width</> },
  { value: 'page',  label: <><UnfoldVertical size={14} aria-hidden="true" /> Fit page</> },
]

// The last fit chosen sticks for the rest of the session, so the next PDF
// opens the way the previous one was being read.
let _lastFit = 'width'

// One page — rendered to a canvas only once it scrolls near the viewport.
function PdfPage({ pdf, pageNumber, fit, box, estimate }) {
  const ref = useRef(null)
  const [show, setShow] = useState(false)
  const [pageSize, setPageSize] = useState(null)
  const width = pageCssWidth(fit, box, pageSize ?? estimate)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShow(true); obs.disconnect() }
    }, { rootMargin: '400px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!show || !width) return
    let cancelled = false
    let task
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const base  = page.getViewport({ scale: 1 })
      if (!pageSize) { setPageSize({ width: base.width, height: base.height }); return }
      const dpr   = window.devicePixelRatio || 1
      const vp    = page.getViewport({ scale: (width / base.width) * dpr })
      const canvas = ref.current?.querySelector('canvas')
      if (!canvas) return
      canvas.width  = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
      try { await task.promise } catch { /* render cancelled */ }
    })()
    return () => { cancelled = true; try { task?.cancel?.() } catch { /* ignore */ } }
  }, [show, width, pdf, pageNumber, pageSize])

  // Until a page is measured it takes the first page's shape, so pages don't
  // all collapse (and intersect) at once.
  const shape = pageSize ?? estimate
  const placeholder = width && shape ? Math.round(width * (shape.height / shape.width)) : 600
  return (
    <div ref={ref} className={styles.page} style={{ width, minHeight: show ? undefined : placeholder }}>
      <canvas />
    </div>
  )
}

export default function PdfPreview({ src, remotePath }) {
  const scrollRef = useRef(null)
  const [pdf,      setPdf]      = useState(null)
  const [error,    setError]    = useState('')
  const [box,      setBox]      = useState({ width: 0, height: 0 })
  const [fit,      setFit]      = useState(_lastFit)
  const [estimate, setEstimate] = useState(null)

  // Track the scroll area's inner size so pages render at the right size.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0
      setBox({ width: Math.max(0, el.clientWidth - 2 * pad), height: Math.max(0, el.clientHeight - 2 * pad) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the reading position when the fit changes: the same fraction of the
  // document stays at the top.
  function changeFit(next) {
    const el = scrollRef.current
    const fraction = el && el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0
    _lastFit = next
    setFit(next)
    requestAnimationFrame(() => {
      if (el) el.scrollTop = fraction * el.scrollHeight
    })
  }

  // Fetch the bytes via the nas-stream URL and open the document.
  useEffect(() => {
    let cancelled = false
    let doc
    ;(async () => {
      try {
        setError(''); setPdf(null)
        const res = await fetch(src)
        if (!res.ok) throw new Error(`Failed to fetch PDF (HTTP ${res.status})`)
        const data = await res.arrayBuffer()
        if (cancelled) return
        doc = await openPdf({ data }).then((task) => task.promise)
        if (cancelled) { doc.destroy?.(); return }
        const first = (await doc.getPage(1)).getViewport({ scale: 1 })
        if (cancelled) return
        setEstimate({ width: first.width, height: first.height })
        setPdf(doc)
      } catch (e) {
        if (cancelled) return
        setError(describePdfError(e))
        // The on-screen line is for the user; the log line is for diagnosing
        // a file that opens elsewhere but not here. Path and error only,
        // never document content.
        window.winraid?.log?.write?.({
          scope: 'pdf-preview',
          level: 'error',
          message: e?.message || 'Failed to load PDF',
          details: { name: e?.name, path: remotePath },
        })
      }
    })()
    return () => { cancelled = true; doc?.destroy?.() }
  }, [src, remotePath])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <SegmentedControl aria-label="Page fit" options={FIT_OPTIONS} value={fit} onChange={changeFit} />
      </div>
      <div ref={scrollRef} className={styles.scroll}>
        {error && <div className={styles.error}>{error}</div>}
        {!error && !pdf && <div className={styles.status}>Loading PDF…</div>}
        {pdf && box.width > 0 && Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage key={i + 1} pdf={pdf} pageNumber={i + 1} fit={fit} box={box} estimate={estimate} />
        ))}
      </div>
    </div>
  )
}
