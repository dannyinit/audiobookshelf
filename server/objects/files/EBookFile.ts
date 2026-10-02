import FileMetadata = require('../metadata/FileMetadata')

type LibraryFile = import('./LibraryFile')

class EBookFile {
  ino: string | null
  metadata: FileMetadata | null
  ebookFormat: string | null
  addedAt: number | null
  updatedAt: number | null

  constructor(file?: Record<string, any>) {
    this.ino = null
    this.metadata = null
    this.ebookFormat = null
    this.addedAt = null
    this.updatedAt = null

    if (file) {
      this.construct(file)
    }
  }

  construct(file: Record<string, any>) {
    this.ino = file.ino
    this.metadata = new FileMetadata(file.metadata)
    this.ebookFormat = file.ebookFormat || this.metadata.format
    this.addedAt = file.addedAt
    this.updatedAt = file.updatedAt
  }

  toJSON() {
    return {
      ino: this.ino,
      metadata: this.metadata!.toJSON(),
      ebookFormat: this.ebookFormat,
      addedAt: this.addedAt,
      updatedAt: this.updatedAt
    }
  }

  get isEpub() {
    return this.ebookFormat === 'epub'
  }

  setData(libraryFile: LibraryFile) {
    this.ino = libraryFile.ino
    this.metadata = libraryFile.metadata!.clone()
    this.ebookFormat = libraryFile.metadata!.format
    this.addedAt = Date.now()
    this.updatedAt = Date.now()
  }

  updateFromLibraryFile(libraryFile: LibraryFile) {
    var hasUpdated = false

    if (this.metadata!.update(libraryFile.metadata!)) {
      hasUpdated = true
    }

    if (this.ebookFormat !== libraryFile.metadata!.format) {
      this.ebookFormat = libraryFile.metadata!.format
      hasUpdated = true
    }

    return hasUpdated
  }
}
export = EBookFile