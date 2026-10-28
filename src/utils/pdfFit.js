// CSS width (px) a PDF page is drawn at inside a viewer box.
//   'width' — the page spans the box's full width
//   'page'  — the whole page fits in the box, limited by height or width
export function pageCssWidth(mode, box, pageSize) {
  if (!box?.width || !pageSize?.width || !pageSize?.height) return 0
  if (mode === 'page') {
    return Math.floor(Math.min(box.width, box.height * (pageSize.width / pageSize.height)))
  }
  return Math.floor(box.width)
}
