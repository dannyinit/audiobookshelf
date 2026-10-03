import Path = require('path')
import fileUtils = require('../../utils/fileUtils')
import globals = require('../../utils/globals')
import FileMetadata = require('../metadata/FileMetadata')
import type { FileMetadataJSON } from '../types'
const { getFileTimestampsWithIno, filePathToPOSIX } = fileUtils

/**
 * LibraryFile as stored in JSON (see toJSON); the input of the constructor (older JSON may lack fields, which are then copied as undefined)
 */
interface LibraryFileData {
  ino: string | null
  metadata?: Partial<FileMetadataJSON> | null
  isSupplementary?: boolean | null
  addedAt: number | null
  updatedAt: number | null
}

/**
 * LibraryFile JSON as typed by the LibraryItem model (LibraryFileObject in models/LibraryItem)
 */
interface LibraryFileJSON {
  ino: string
  metadata: FileMetadataJSON
  isSupplementary: boolean
  addedAt: number
  updatedAt: number
  fileType: string
}

class LibraryFile {
  declare ino: string | null
  declare metadata: FileMetadata
  declare isSupplementary: boolean | null
  declare addedAt: number | null
  declare updatedAt: number | null

  constructor(file?: LibraryFileData | null) {
    this.ino = null
    // Typed FileMetadata; construct or setDataFromPath sets it before use
    this.metadata = null as unknown as FileMetadata
    this.isSupplementary = null
    this.addedAt = null
    this.updatedAt = null

    if (file) {
      this.construct(file)
    }
  }

  construct(file: LibraryFileData) {
    this.ino = file.ino
    this.metadata = new FileMetadata(file.metadata)
    this.isSupplementary = file.isSupplementary === undefined ? null : file.isSupplementary
    this.addedAt = file.addedAt
    this.updatedAt = file.updatedAt
  }

  toJSON() {
    // Typed as set: toJSON is only called on files that construct or setDataFromPath filled in (isSupplementary may still be null)
    return {
      ino: this.ino,
      metadata: this.metadata.toJSON(),
      isSupplementary: this.isSupplementary,
      addedAt: this.addedAt,
      updatedAt: this.updatedAt,
      fileType: this.fileType
    } as LibraryFileJSON
  }

  clone() {
    return new LibraryFile(this.toJSON())
  }

  get fileType() {
    if (globals.SupportedImageTypes.includes(this.metadata.format)) return 'image'
    if (globals.SupportedAudioTypes.includes(this.metadata.format)) return 'audio'
    if (globals.SupportedEbookTypes.includes(this.metadata.format)) return 'ebook'
    if (globals.TextFileTypes.includes(this.metadata.format)) return 'text'
    if (globals.MetadataFileTypes.includes(this.metadata.format)) return 'metadata'
    return 'unknown'
  }

  get isMediaFile() {
    return this.fileType === 'audio' || this.fileType === 'ebook'
  }

  get isEBookFile() {
    return this.fileType === 'ebook'
  }

  get isOPFFile() {
    return this.metadata.ext === '.opf'
  }

  async setDataFromPath(path: string, relPath: string) {
    // NOTE: getFileTimestampsWithIno returns false when stat fails; then ino is undefined and no timestamps are set
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
