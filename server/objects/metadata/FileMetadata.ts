import type { FileMetadataJSON } from '../types'

class FileMetadata {
  declare filename: string | null
  declare ext: string | null
  declare path: string | null
  declare relPath: string | null
  declare size: number | null
  declare mtimeMs: number | null
  declare ctimeMs: number | null
  declare birthtimeMs: number | null
  declare wasModified: boolean

  constructor(metadata?: Partial<FileMetadataJSON> | null) {
    this.filename = null
    this.ext = null
    this.path = null
    this.relPath = null
    this.size = null
    this.mtimeMs = null
    this.ctimeMs = null
    this.birthtimeMs = null

    if (metadata) {
      // Missing fields are copied as undefined, like the JS
      this.construct(metadata as FileMetadataJSON)
    }

    // Temp flag used in scans
    this.wasModified = false
  }

  construct(metadata: FileMetadataJSON) {
    this.filename = metadata.filename
    this.ext = metadata.ext
    this.path = metadata.path
    this.relPath = metadata.relPath
    this.size = metadata.size
    this.mtimeMs = metadata.mtimeMs
    this.ctimeMs = metadata.ctimeMs
    this.birthtimeMs = metadata.birthtimeMs
  }

  toJSON() {
    // Typed as set: toJSON is only called on metadata that construct or setData filled in
    return {
      filename: this.filename,
      ext: this.ext,
      path: this.path,
      relPath: this.relPath,
      size: this.size,
      mtimeMs: this.mtimeMs,
      ctimeMs: this.ctimeMs,
      birthtimeMs: this.birthtimeMs
    } as FileMetadataJSON
  }

  clone() {
    return new FileMetadata(this.toJSON())
  }

  get format() {
    if (!this.ext) return ''
    return this.ext.slice(1).toLowerCase()
  }
  get filenameNoExt() {
    // Non-null: only read on files that were constructed with a filename and ext
    return this.filename!.replace(this.ext!, '')
  }

  update(payload: object) {
    // Index this object and the payload by key
    const self = this as unknown as Record<string, unknown>
    const values = payload as Record<string, unknown>
    var hasUpdates = false
    for (const key in values) {
      if (self[key] !== undefined && self[key] !== values[key]) {
        self[key] = values[key]
        hasUpdates = true
      }
    }
    return hasUpdates
  }

  setData(payload: object) {
    // Index this object and the payload by key
    const self = this as unknown as Record<string, unknown>
    const values = payload as Record<string, unknown>
    for (const key in values) {
      if (self[key] !== undefined) {
        self[key] = values[key]
      }
    }
  }
}
export = FileMetadata
