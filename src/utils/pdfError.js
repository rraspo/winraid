// A readable line for whatever pdf.js threw while opening a document.
export function describePdfError(error) {
  if (error?.name === 'PasswordException') return 'This PDF is password-protected'
  if (error?.name === 'InvalidPDFException') {
    return `This PDF could not be read: ${error.message || 'invalid file structure'}`
  }
  return error?.message || 'Failed to load PDF'
}
