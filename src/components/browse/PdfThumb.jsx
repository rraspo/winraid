import { memo, useState, useEffect, useRef } from 'react'
import { acquireDecodeSlot } from '../../utils/decodeSlots'
import { openPdf } from '../../utils/pdfjsLoader'
import styles from './PdfThumb.module.css'

// How long a card must stay on screen before its PDF is opened; a fling
// through a folder must not start a document load per card.
export const DWELL_MS = 250

// A render that has produced nothing by now is stuck (a stalled stream, a
// broken file); give its slot to someone else.
const RENDER_TIMEOUT_MS = 20_000

const STILL_WIDTH = 320
const STILL_QUALITY = 0.8

async function fetchWhole(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch PDF (HTTP ${response.status})`)
  return response.arrayBuffer()
}

// Range loading keeps a big PDF from being downloaded for one thumbnail. If it
// fails for any reason the whole file is fetched instead, as Quick Look does.
async function openFirstPage(url) {
  let task = openPdf({ url, disableAutoFetch: true, disableStream: true })
  try {
    return { task, document: await task.promise }
  } catch {
    task.destroy?.()
  }
  task = openPdf({ data: await fetchWhole(url) })
  return { task, document: await task.promise }
}

async function renderStill(url, isCancelled) {
  const { task, document: pdfDocument } = await openFirstPage(url)
  try {
    const page = await pdfDocument.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: STILL_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    if (isCancelled()) return null
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', STILL_QUALITY))
  } finally {
    // Frees the worker's copy of the document along with the transport.
    task.destroy?.()
  }
}

// A PDF first-page thumbnail that costs nothing until it is worth it: the
// placeholder first; a still saved on an earlier visit if the cache has one;
// otherwise, once the card has stayed visible for DWELL_MS and a decode slot is
// free, page 1 rendered at thumbnail size and cached as WebP.
const PdfThumb = memo(function PdfThumb({ url, connectionId, remotePath, modified, placeholder = null, onError }) {
  const wrapRef = useRef(null)
  const [still, setStill] = useState(null)
  const [lookupDone, setLookupDone] = useState(false)
  const [dwelled, setDwelled] = useState(false)
  const [granted, setGranted] = useState(false)

  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    if (!connectionId || !remotePath) {
      setLookupDone(true)
      return undefined
    }
    Promise.resolve(window.winraid?.cache?.getVideoFrame?.(connectionId, remotePath, modified))
      .then((cached) => {
        if (cancelled) return
        if (cached?.hit && cached.bytes) setStill(URL.createObjectURL(new Blob([cached.bytes], { type: 'image/webp' })))
        setLookupDone(true)
      })
      .catch(() => { if (!cancelled) setLookupDone(true) })
    return () => { cancelled = true }
  }, [connectionId, remotePath, modified])

  useEffect(() => () => { if (still) URL.revokeObjectURL(still) }, [still])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || dwelled) return undefined
    let timer = null
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (!timer) timer = setTimeout(() => setDwelled(true), DWELL_MS)
      } else {
        clearTimeout(timer)
        timer = null
      }
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => { clearTimeout(timer); observer.disconnect() }
  }, [dwelled])

  const wantsRender = dwelled && lookupDone && !still
  useEffect(() => {
    if (!wantsRender) return undefined
    const slot = acquireDecodeSlot(() => setGranted(true))
    return () => { slot.release(); setGranted(false) }
  }, [wantsRender])

  useEffect(() => {
    if (!granted) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      cancelled = true
      onErrorRef.current?.()
    }, RENDER_TIMEOUT_MS)
    renderStill(url, () => cancelled)
      .then(async (blob) => {
        if (cancelled) return
        if (!blob) throw new Error('Could not encode the page')
        setStill(URL.createObjectURL(blob))
        if (connectionId && remotePath && typeof modified === 'number') {
          const bytes = new Uint8Array(await blob.arrayBuffer())
          window.winraid?.cache?.saveVideoFrame?.(connectionId, remotePath, modified, bytes, {})
        }
      })
      .catch(() => { if (!cancelled) onErrorRef.current?.() })
      .finally(() => clearTimeout(timer))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [granted]) // eslint-disable-line react-hooks/exhaustive-deps -- url/path are stable for a mounted card

  return (
    <span ref={wrapRef} className={styles.wrap}>
      {still
        ? <img src={still} className={styles.thumbFill} decoding="async" alt="" />
        : <span className={styles.placeholder}>{placeholder}</span>}
    </span>
  )
})

export default PdfThumb
