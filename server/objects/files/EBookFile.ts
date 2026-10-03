import FileMetadata = require('../metadata/FileMetadata')
import type LibraryFile = require('./LibraryFile')
import type { FileMetadataJSON } from '../types'

/**
 * EBookFile as stored in JSON (see toJSON); the input of the constructor (older JSON may lack fields, which are then copied as undefined)
 */
interface EBookFileData {
  ino: string | null
  metadata?: Partial<FileMetadataJSON> | null
  ebookFormat?: string | null
  addedAt: number | null
  updatedAt: number | null
}

class EBookFile {
  declare ino: string | null
  declare metadata: FileMetadata
  declare ebookFormat: string | null
  declare addedAt: number | null
  declare updatedAt: number | null

  constructor(file?: EBookFileData | null) {
    this.ino = null
    // Typed FileMetadata; construct or setData sets it before use
    this.metadata = null as unknown as FileMetadata
    this.ebookFormat = null
    this.addedAt = null
    this.updatedAt = null

    if (file) {
      this.construct(file)
    }
  }

  construct(file: EBookFileData) {
    this.ino = file.ino
    this.metadata = new FileMetadata(file.metadata)
    this.ebookFormat = file.ebookFormat || this.metadata.format
    this.addedAt = file.addedAt
    this.updatedAt = file.updatedAt
  }

  toJSON() {
    return {
      ino: this.ino,
      metadata: this.metadata.toJSON(),
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
    this.metadata = libraryFile.metadata.clone()
    this.ebookFormat = libraryFile.metadata.format
    this.addedAt = Date.now()
    this.updatedAt = Date.now()
  }

  updateFromLibraryFile(libraryFile: LibraryFile) {
    var hasUpdated = false

    if (this.metadata.update(libraryFile.metadata)) {
      hasUpdated = true
    }

    if (this.ebookFormat !== libraryFile.metadata.format) {
      this.ebookFormat = libraryFile.metadata.format
      hasUpdated = true
    }

    return hasUpdated
  }
}
export = EBookFile
