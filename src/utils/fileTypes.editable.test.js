import { describe, it, expect } from 'vitest'
import { isEditableFile, fileType } from './fileTypes'

describe('fileType — non-binary files preview as text', () => {
  it('classifies log/markdown/code/conf/extensionless as text', () => {
    for (const name of ['app.log', 'notes.md', 'main.js', 'nginx.conf', 'Dockerfile']) {
      expect(fileType(name), name).toBe('text')
    }
  })
  it('keeps media / pdf / binary classification intact', () => {
    expect(fileType('a.jpg')).toBe('image')
    expect(fileType('a.mp4')).toBe('video')
    expect(fileType('a.mp3')).toBe('audio')
    expect(fileType('a.pdf')).toBe('pdf')
    expect(fileType('a.zip')).toBe('unknown')
  })
})

describe('isEditableFile — edit anything that is not binary', () => {
  it('treats text / config / log / code / extensionless files as editable', () => {
    for (const name of [
      'app.log', 'README.md', 'data.csv', 'nginx.conf', 'notes.txt',
      'main.js', 'app.ts', 'style.css', 'index.html', 'query.sql',
      'icon.svg', 'config.yml', 'Dockerfile', '.gitignore', 'hosts',
    ]) {
      expect(isEditableFile(name), name).toBe(true)
    }
  })

  it('treats binary files as not editable', () => {
    for (const name of [
      'photo.jpg', 'image.png', 'clip.mp4', 'song.mp3', 'doc.pdf',
      'archive.zip', 'backup.tar.gz', 'app.exe', 'lib.dll',
      'sheet.xlsx', 'slides.pptx', 'font.woff2', 'data.sqlite', 'disk.iso',
    ]) {
      expect(isEditableFile(name), name).toBe(false)
    }
  })
})
