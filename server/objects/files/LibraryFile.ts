import Path = require('path')
import { getFileTimestampsWithIno, filePathToPOSIX } from '../../utils/fileUtils'
import globals = require('../../utils/globals')
import FileMetadata = require('../metadata/FileMetadata')

class LibraryFile {
  ino: string | null
  metadata: FileMetadata | null
  isSupplementary: boolean | null
  addedAt: number | null
  updatedAt: number | null

  constructor(file?: Record<string, any>) {
    this.ino = null
    this.metadata = null
    this.isSupplementary = null
    this.addedAt = null
    this.updatedAt = null

    if (file) {
      this.construct(file)
    }
  }

  construct(file: Record<string, any>) {
    this.ino = file.ino
    this.metadata = new FileMetadata(file.metadata)
    this.isSupplementary = file.isSupplementary === undefined ? null : file.isSupplementary
    this.addedAt = file.addedAt
    this.updatedAt = file.updatedAt
  }

  toJSON() {
    return {
      ino: this.ino,
      metadata: this.metadata!.toJSON(),
      isSupplementary: this.isSupplementary,
      addedAt: this.addedAt,
      updatedAt: this.updatedAt,
      fileType: this.fileType
    }
  }

  clone() {
    return new LibraryFile(this.toJSON())
  }

  get fileType() {
    const format = this.metadata!.format
    if (globals.SupportedImageTypes.includes(format)) return 'image'
    if (globals.SupportedAudioTypes.includes(format)) return 'audio'
    if (globals.SupportedEbookTypes.includes(format)) return 'ebook'
    if (globals.TextFileTypes.includes(format)) return 'text'
    if (globals.MetadataFileTypes.includes(format)) return 'metadata'
    return 'unknown'
  }

  get isMediaFile() {
    return this.fileType === 'audio' || this.fileType === 'ebook'
  }

  get isEBookFile() {
    return this.fileType === 'ebook'
  }

  get isOPFFile() {
    return this.metadata!.ext === '.opf'
  }

  async setDataFromPath(path: string, relPath: string) {
    // getFileTimestampsWithIno returns false if the file can't be stat'd, which the original code did not handle either
    var fileTsData = (await getFileTimestampsWithIno(path)) as Exclude<Awaited<ReturnType<typeof getFileTimestampsWithIno>>, false>
    var fileMetadata = new FileMetadata()
    fileMetadata.setData(fileTsData)
    fileMetadata.filename = Path.basename(relPath)
    fileMetadata.path = filePathToPOSIX(path)
    fileMetadata.relPath = filePathToPOSIX(relPath)
    fileMetadata.ext = Path.extname(relPath)
    this.ino = fileTsData.ino
    this.metadata = fileMetadata
    this.addedAt = Date.now()
    this.updatedAt = Date.now()
  }
}
export = LibraryFile
