import packageJson = require('../../package.json')
import constants = require('../utils/constants')
// Only used as a type; required for its side effects so the module load order stays as in the JS
import '../models/LibraryItem'
import type LibraryItem = require('../models/LibraryItem')
import globals = require('../utils/globals')
import type LibraryFile = require('../objects/files/LibraryFile')
import type scandir = require('../utils/scandir')
import type LibraryScan = require('./LibraryScan')
import type ScanLogger = require('./ScanLogger')
import type { AudioFileObject, EBookFileObject, LibraryFileObject } from '../models/types'
import type { BookMetadataObject, NewLibraryItemObject } from './types'
import dynamicKey = require('./dynamicKey')
const { getKey, setKey } = dynamicKey
const { LogLevel } = constants

interface LibraryFileModifiedObject {
  old: LibraryFileObject
  new: LibraryFileObject
}

/**
 * Library item metadata parsed from the folder and file names (see utils/scandir)
 */
type LibraryItemFilenameMetadata = ReturnType<typeof scandir.getBookDataFromDir>

/**
 * Data of a scanned library item folder or file (see LibraryItemScanner getLibraryItemScanData)
 */
interface LibraryItemScanDataInput {
  libraryFolderId: string
  libraryId: string
  mediaType: string
  ino: string
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
  path: string
  relPath: string
  isFile: boolean
  mediaMetadata: LibraryItemFilenameMetadata
  libraryFiles: LibraryFile[]
}

class LibraryItemScanData {
  declare libraryFolderId: string
  declare libraryId: string
  declare mediaType: string
  declare ino: string
  declare mtimeMs: number
  declare ctimeMs: number
  declare birthtimeMs: number
  declare path: string
  declare relPath: string
  declare isFile: boolean
  declare mediaMetadata: LibraryItemFilenameMetadata
  declare libraryFiles: LibraryFile[]
  /** Set by checkLibraryItemData */
  declare hasChanges: boolean
  /** Set by checkLibraryItemData */
  declare hasPathChange: boolean
  declare libraryFilesRemoved: LibraryFileObject[]
  declare libraryFilesAdded: LibraryFile[]
  declare libraryFilesModified: LibraryFileModifiedObject[]

  constructor(data: LibraryItemScanDataInput) {
    this.libraryFolderId = data.libraryFolderId
    this.libraryId = data.libraryId
    this.mediaType = data.mediaType
    this.ino = data.ino
    this.mtimeMs = data.mtimeMs
    this.ctimeMs = data.ctimeMs
    this.birthtimeMs = data.birthtimeMs
    this.path = data.path
    this.relPath = data.relPath
    this.isFile = data.isFile
    this.mediaMetadata = data.mediaMetadata
    this.libraryFiles = data.libraryFiles

    // Set after check
    this.hasChanges
    this.hasPathChange
    this.libraryFilesRemoved = []
    this.libraryFilesAdded = []
    this.libraryFilesModified = []
  }

  /**
   * Used to create a library item
   */
  get libraryItemObject(): NewLibraryItemObject {
    let size = 0
    // cast(d): isNaN coerces a null size to 0, as in the JS
    this.libraryFiles.forEach((lf) => size += (!isNaN(lf.metadata.size as number) ? Number(lf.metadata.size) : 0))
    return {
      ino: this.ino,
      path: this.path,
      relPath: this.relPath,
      mediaType: this.mediaType,
      isFile: this.isFile,
      mtime: this.mtimeMs,
      ctime: this.ctimeMs,
      birthtime: this.birthtimeMs,
      lastScan: Date.now(),
      lastScanVersion: packageJson.version,
      libraryFiles: this.libraryFiles,
      libraryId: this.libraryId,
      libraryFolderId: this.libraryFolderId,
      size
    }
  }

  get hasLibraryFileChanges() {
    return this.libraryFilesRemoved.length + this.libraryFilesModified.length + this.libraryFilesAdded.length
  }

  get hasAudioFileChanges() {
    return (this.audioLibraryFilesRemoved.length + this.audioLibraryFilesAdded.length + this.audioLibraryFilesModified.length) > 0
  }

  /** @type {LibraryFileModifiedObject[]} */
  get audioLibraryFilesModified() {
    return this.libraryFilesModified.filter(lf => globals.SupportedAudioTypes.includes(lf.old.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get audioLibraryFilesRemoved() {
    return this.libraryFilesRemoved.filter(lf => globals.SupportedAudioTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get audioLibraryFilesAdded() {
    return this.libraryFilesAdded.filter(lf => globals.SupportedAudioTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get audioLibraryFiles() {
    return this.libraryFiles.filter(lf => globals.SupportedAudioTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryFileModifiedObject[]} */
  get imageLibraryFilesModified() {
    return this.libraryFilesModified.filter(lf => globals.SupportedImageTypes.includes(lf.old.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get imageLibraryFilesRemoved() {
    return this.libraryFilesRemoved.filter(lf => globals.SupportedImageTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get imageLibraryFilesAdded() {
    return this.libraryFilesAdded.filter(lf => globals.SupportedImageTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get imageLibraryFiles() {
    return this.libraryFiles.filter(lf => globals.SupportedImageTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryFileModifiedObject[]} */
  get ebookLibraryFilesModified() {
    return this.libraryFilesModified.filter(lf => globals.SupportedEbookTypes.includes(lf.old.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get ebookLibraryFilesRemoved() {
    return this.libraryFilesRemoved.filter(lf => globals.SupportedEbookTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get ebookLibraryFilesAdded() {
    return this.libraryFilesAdded.filter(lf => globals.SupportedEbookTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject[]} */
  get ebookLibraryFiles() {
    return this.libraryFiles.filter(lf => globals.SupportedEbookTypes.includes(lf.metadata.ext?.slice(1).toLowerCase() || ''))
  }

  /** @type {LibraryItem.LibraryFileObject} */
  get descTxtLibraryFile() {
    return this.libraryFiles.find(lf => lf.metadata.filename === 'desc.txt')
  }

  /** @type {LibraryItem.LibraryFileObject} */
  get readerTxtLibraryFile() {
    return this.libraryFiles.find(lf => lf.metadata.filename === 'reader.txt')
  }

  /** @type {LibraryItem.LibraryFileObject} */
  get metadataAbsLibraryFile() {
    return this.libraryFiles.find(lf => lf.metadata.filename === 'metadata.abs')
  }

  /** @type {LibraryItem.LibraryFileObject} */
  get metadataJsonLibraryFile() {
    return this.libraryFiles.find(lf => lf.metadata.filename === 'metadata.json')
  }

  /** @type {LibraryItem.LibraryFileObject} */
  get metadataOpfLibraryFile() {
    // cast(d): scanned library files have an extension (set by setDataFromPath)
    return this.libraryFiles.find(lf => lf.metadata.ext!.toLowerCase() === '.opf')
  }

  /** @type {LibraryItem.LibraryFileObject} */
  get metadataNfoLibraryFile() {
    // cast(d): scanned library files have an extension (set by setDataFromPath)
    return this.libraryFiles.find(lf => lf.metadata.ext!.toLowerCase() === '.nfo')
  }

  /**
   * @returns true if changes found
   */
  async checkLibraryItemData(existingLibraryItem: LibraryItem, libraryScan: LibraryScan | ScanLogger): Promise<boolean> {
    const keysToCompare = ['libraryFolderId', 'ino', 'path', 'relPath', 'isFile']
    this.hasChanges = false
    this.hasPathChange = false
    for (const key of keysToCompare) {
      if (getKey(existingLibraryItem, key) !== getKey(this, key)) {
        libraryScan.addLog(LogLevel.DEBUG, `Library item "${existingLibraryItem.relPath}" key "${key}" changed from "${getKey(existingLibraryItem, key)}" to "${getKey(this, key)}"`)
        // Dynamic metadata key: the keys are libraryFolderId, ino, path, relPath and isFile, which have the same types on both
        setKey(existingLibraryItem, key, getKey(this, key))
        this.hasChanges = true

        if (key === 'relPath' || key === 'path') {
          this.hasPathChange = true
        }
      }
    }

    // Check mtime, ctime and birthtime
    if (existingLibraryItem.mtime?.valueOf() !== this.mtimeMs) {
      libraryScan.addLog(LogLevel.DEBUG, `Library item "${existingLibraryItem.relPath}" key "mtime" changed from "${existingLibraryItem.mtime?.valueOf()}" to "${this.mtimeMs}"`)
      existingLibraryItem.mtime = this.mtimeMs
      this.hasChanges = true
    }
    if (existingLibraryItem.birthtime?.valueOf() !== this.birthtimeMs) {
      libraryScan.addLog(LogLevel.DEBUG, `Library item "${existingLibraryItem.relPath}" key "birthtime" changed from "${existingLibraryItem.birthtime?.valueOf()}" to "${this.birthtimeMs}"`)
      existingLibraryItem.birthtime = this.birthtimeMs
      this.hasChanges = true
    }
    if (existingLibraryItem.ctime?.valueOf() !== this.ctimeMs) {
      libraryScan.addLog(LogLevel.DEBUG, `Library item "${existingLibraryItem.relPath}" key "ctime" changed from "${existingLibraryItem.ctime?.valueOf()}" to "${this.ctimeMs}"`)
      existingLibraryItem.ctime = this.ctimeMs
      this.hasChanges = true
    }
    if (existingLibraryItem.isMissing) {
      libraryScan.addLog(LogLevel.DEBUG, `Library item "${existingLibraryItem.relPath}" was missing but now found`)
      existingLibraryItem.isMissing = false
      this.hasChanges = true
    }

    this.libraryFilesRemoved = []
    this.libraryFilesModified = []
    let libraryFilesAdded = this.libraryFiles.map(lf => lf)

    for (const existingLibraryFile of existingLibraryItem.libraryFiles) {
      // Find matching library file using path first and fallback to using inode value
      let matchingLibraryFile = this.libraryFiles.find(lf => lf.metadata.path === existingLibraryFile.metadata.path)
      if (!matchingLibraryFile) {
        matchingLibraryFile = this.libraryFiles.find(lf => lf.ino === existingLibraryFile.ino)
        if (matchingLibraryFile) {
          libraryScan.addLog(LogLevel.INFO, `Library file with path "${existingLibraryFile.metadata.path}" not found, but found file with matching inode value "${existingLibraryFile.ino}" at path "${matchingLibraryFile.metadata.path}"`)
        }
      }

      if (!matchingLibraryFile) { // Library file removed
        libraryScan.addLog(LogLevel.INFO, `Library file "${existingLibraryFile.metadata.path}" was removed from library item "${existingLibraryItem.relPath}"`)
        this.libraryFilesRemoved.push(existingLibraryFile)
        existingLibraryItem.libraryFiles = existingLibraryItem.libraryFiles.filter(lf => lf !== existingLibraryFile)
        this.hasChanges = true
      } else {
        libraryFilesAdded = libraryFilesAdded.filter(lf => lf !== matchingLibraryFile)
        let existingLibraryFileBefore = structuredClone(existingLibraryFile)
        if (this.compareUpdateLibraryFile(existingLibraryItem.path, existingLibraryFile, matchingLibraryFile, libraryScan)) {
          this.libraryFilesModified.push({old: existingLibraryFileBefore, new: existingLibraryFile})
          this.hasChanges = true
        }
      }
    }

    // Log new library files found
    if (libraryFilesAdded.length) {
      this.hasChanges = true
      for (const libraryFile of libraryFilesAdded) {
        libraryScan.addLog(LogLevel.INFO, `New library file found with path "${libraryFile.metadata.path}" for library item "${existingLibraryItem.relPath}"`)
        if (libraryFile.isEBookFile) {
          // Set all new ebook files as supplementary
          libraryFile.isSupplementary = true
        }
        existingLibraryItem.libraryFiles.push(libraryFile.toJSON())
      }
    }

    this.libraryFilesAdded = libraryFilesAdded

    if (this.hasChanges) {
      existingLibraryItem.size = 0
      existingLibraryItem.libraryFiles.forEach((lf) => existingLibraryItem.size += lf.metadata.size)

      existingLibraryItem.lastScan = Date.now()
      existingLibraryItem.lastScanVersion = packageJson.version

      // cast(d): changed() returns false when nothing changed; false?.join is undefined, as in the JS
      libraryScan.addLog(LogLevel.DEBUG, `Library item "${existingLibraryItem.relPath}" changed: [${(existingLibraryItem.changed() as string[] | undefined)?.join(',') || ''}]`)

      if (this.hasLibraryFileChanges) {
        existingLibraryItem.changed('libraryFiles', true)
      }
      await existingLibraryItem.save()
      return true
    }

    return false
  }

  /**
   * Update existing library file with scanned in library file data
   * @returns false if no changes
   */
  compareUpdateLibraryFile(libraryItemPath: string, existingLibraryFile: LibraryFileObject, scannedLibraryFile: LibraryFile, libraryScan: LibraryScan | ScanLogger): boolean {
    let hasChanges = false

    if (existingLibraryFile.ino !== scannedLibraryFile.ino) {
      // cast(d): setDataFromPath sets the ino of scanned files
      existingLibraryFile.ino = scannedLibraryFile.ino!
      hasChanges = true
    }

    for (const key in existingLibraryFile.metadata) {
      if (getKey(existingLibraryFile.metadata, key) !== getKey(scannedLibraryFile.metadata, key)) {
        if (key !== 'path' && key !== 'relPath') {
          libraryScan.addLog(LogLevel.DEBUG, `Library file "${existingLibraryFile.metadata.relPath}" for library item "${libraryItemPath}" key "${key}" changed from "${getKey(existingLibraryFile.metadata, key)}" to "${getKey(scannedLibraryFile.metadata, key)}"`)
        } else {
          libraryScan.addLog(LogLevel.DEBUG, `Library file for library item "${libraryItemPath}" key "${key}" changed from "${getKey(existingLibraryFile.metadata, key)}" to "${getKey(scannedLibraryFile.metadata, key)}"`)
        }
        // Dynamic metadata key: the same file metadata keys on both
        setKey(existingLibraryFile.metadata, key, getKey(scannedLibraryFile.metadata, key))
        hasChanges = true
      }
    }

    if (hasChanges) {
      existingLibraryFile.updatedAt = Date.now()
    }

    return hasChanges
  }

  /**
   * Check if existing audio file on Book was removed
   * @returns true if audio file was removed
   */
  checkAudioFileRemoved(existingAudioFile: AudioFileObject): boolean {
    if (!this.audioLibraryFilesRemoved.length) return false
    // First check exact path
    if (this.audioLibraryFilesRemoved.some(af => af.metadata.path === existingAudioFile.metadata.path)) {
      return true
    }
    // Fallback to check inode value
    return this.audioLibraryFilesRemoved.some(af => af.ino === existingAudioFile.ino)
  }

  /**
   * Check if existing ebook file on Book was removed
   * @returns true if ebook file was removed
   */
  checkEbookFileRemoved(ebookFile: EBookFileObject): boolean {
    if (!this.ebookLibraryFiles.length) return true

    if (this.ebookLibraryFiles.some(lf => lf.metadata.path === ebookFile.metadata.path)) {
      return false
    }

    return !this.ebookLibraryFiles.some(lf => lf.ino === ebookFile.ino)
  }

  /**
   * Set data parsed from filenames
   */
  setBookMetadataFromFilenames(bookMetadata: BookMetadataObject) {
    const keysToMap = ['title', 'subtitle', 'publishedYear', 'asin']
    for (const key in this.mediaMetadata) {
      if (keysToMap.includes(key) && getKey(this.mediaMetadata, key)) {
        setKey(bookMetadata, key, getKey(this.mediaMetadata, key))
      }
    }

    if (this.mediaMetadata.authors?.length) {
      // cast(d): the name parser types its names as possibly undefined; they are the parsed strings
      bookMetadata.authors = this.mediaMetadata.authors as string[]
    }
    if (this.mediaMetadata.narrators?.length) {
      // cast(d): the name parser types its names as possibly undefined; they are the parsed strings
      bookMetadata.narrators = this.mediaMetadata.narrators as string[]
    }
    if (this.mediaMetadata.seriesName) {
      bookMetadata.series = [
        {
          name: this.mediaMetadata.seriesName,
          sequence: this.mediaMetadata.seriesSequence || null
        }
      ]
    }
  }
}
export = LibraryItemScanData