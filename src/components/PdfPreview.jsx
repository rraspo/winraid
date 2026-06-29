import { useEffect, useRef, useState } from 'react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import styles from './PdfPreview.module.css'

// Lazy-load the (large) pdfjs library only when a PDF is actually opened.
let _pdfjsPromise = null
function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })
  }
  return _pdfjsPromise
}

// One page — rendered to a canvas only once it scrolls near the viewport.
function PdfPage({ pdf, pageNumber, width }) {
  const ref = useRef(null)
  const [show, setShow] = useState(false)

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
      const dpr   = window.devicePixelRatio || 1
      const base  = page.getViewport({ scale: 1 })
      const vp    = page.getViewport({ scale: (width / base.width) * dpr })
      const canvas = ref.current?.querySelector('canvas')
      if (!canvas) return
      canvas.width  = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp })
      try { await task.promise } catch { /* render cancelled */ }
    })()
    return () => { cancelled = true; try { task?.cancel?.() } catch { /* ignore */ } }
  }, [show, width, pdf, pageNumber])

  // Letter-ish placeholder height so pages don't all collapse (and intersect) at once.
  const placeholder = width ? Math.round(width * 1.3) : 600
  return (
    <div ref={ref} className={styles.page} style={{ minHeight: show ? undefined : placeholder }}>
      <canvas />
    </div>
  )
}

export default function PdfPreview({ src }) {
  const rootRef = useRef(null)
  const [pdf,   setPdf]   = useState(null)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(0)

  // Track available width so pages render at the right size.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setWidth(Math.max(0, Math.min(900, el.clientWidth - 32)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fetch the bytes via the nas-stream URL and open the document.
  useEffect(() => {
    let cancelled = false
    let doc
    ;(async () => {
      try {
        setError(''); setPdf(null)
        const pdfjs = await getPdfjs()
        const res = await fetch(src)
        if (!res.ok) throw new Error(`Failed to fetch PDF (HTTP ${res.status})`)
        const data = await res.arrayBuffer()
        if (cancelled) return
        doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) { doc.destroy?.(); return }
        setPdf(doc)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load PDF')
      }
    })()
    return () => { cancelled = true; doc?.destroy?.() }
  }, [src])

  return (
    <div ref={rootRef} className={styles.root}>
      {error && <div className={styles.error}>{error}</div>}
      {!error && !pdf && <div className={styles.status}>Loading PDF…</div>}
      {pdf && width > 0 && Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPage key={i + 1} pdf={pdf} pageNumber={i + 1} width={width} />
      ))}
    </div>
  )
}
