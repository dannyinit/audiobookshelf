class FileMetadata {
  filename: string | null
  ext: string | null
  path: string | null
  relPath: string | null
  size: number | null
  mtimeMs: number | null
  ctimeMs: number | null
  birthtimeMs: number | null
  /** Temp flag used in scans */
  wasModified: boolean

  constructor(metadata?: Record<string, any> | null) {
    this.filename = null
    this.ext = null
    this.path = null
    this.relPath = null
    this.size = null
    this.mtimeMs = null
    this.ctimeMs = null
    this.birthtimeMs = null

    if (metadata) {
      this.construct(metadata)
    }

    this.wasModified = false
  }

  construct(metadata: Record<string, any>) {
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
    return {
      filename: this.filename,
      ext: this.ext,
      path: this.path,
      relPath: this.relPath,
      size: this.size,
      mtimeMs: this.mtimeMs,
      ctimeMs: this.ctimeMs,
      birthtimeMs: this.birthtimeMs
    }
  }

  clone() {
    return new FileMetadata(this.toJSON())
  }

  get format() {
    if (!this.ext) return ''
    return this.ext.slice(1).toLowerCase()
  }
  get filenameNoExt() {
    return this.filename!.replace(this.ext!, '')
  }

  update(payload: Record<string, any>) {
    const self = this as Record<string, any>
    var hasUpdates = false
    for (const key in payload) {
      if (self[key] !== undefined && self[key] !== payload[key]) {
        self[key] = payload[key]
        hasUpdates = true
      }
    }
    return hasUpdates
  }

  setData(payload: Record<string, any>) {
    const self = this as Record<string, any>
    for (const key in payload) {
      if (self[key] !== undefined) {
        self[key] = payload[key]
      }
    }
  }
}
export = FileMetadata