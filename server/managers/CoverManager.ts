import fs = require('../libs/fsExtra')
import Path = require('path')
import Logger = require('../Logger')
import readChunk = require('../libs/readChunk')
import imageType = require('../libs/imageType')

import globals = require('../utils/globals')
import fileUtils = require('../utils/fileUtils')
import ffmpegHelpers = require('../utils/ffmpegHelpers')
import parseEbookMetadata = require('../utils/parsers/parseEbookMetadata')

import CacheManager = require('../managers/CacheManager')
import type LibraryItem = require('../models/LibraryItem')
import type AudioFile = require('../objects/files/AudioFile')
import type { AudioFileObject } from '../models/types'
import type { EBookFileScanData } from '../utils/parsers/types'
const { downloadImageFile, filePathToPOSIX, checkPathIsFile } = fileUtils
const { extractCoverArt } = ffmpegHelpers

/**
 * Image type detected by the vendored image-type (server/libs/imageType), or the error when the file is not a supported image
 */
type ImageTypeResult = { ext: string; mime: string; error?: undefined } | { error: string; ext?: undefined }

/**
 * Result of setting a cover: the error, or the path of the new cover
 */
type CoverResult = { error: string; cover?: undefined } | { cover: string; error?: undefined }

/**
 * Uploaded file from req.files (express-fileupload), only what is used
 */
interface UploadedCoverFile {
  name: string
  mv(path: string): Promise<void>
}

class CoverManager {
  constructor() {}

  getCoverDirectory(libraryItem: LibraryItem) {
    if (global.ServerSettings.storeCoverWithItem && !libraryItem.isFile) {
      return libraryItem.path
    } else {
      return Path.posix.join(Path.posix.join(global.MetadataPath, 'items'), libraryItem.id)
    }
  }

  getFilesInDirectory(dir: string) {
    try {
      return fs.readdir(dir)
    } catch (error) {
      Logger.error(`[CoverManager] Failed to get files in dir ${dir}`, error)
      return []
    }
  }

  removeFile(filepath: string) {
    try {
      return fs.pathExists(filepath).then<void | false>((exists) => {
        if (!exists) Logger.warn(`[CoverManager] Attempting to remove file that does not exist ${filepath}`)
        return exists ? fs.unlink(filepath) : false
      })
    } catch (error) {
      Logger.error(`[CoverManager] Failed to remove file "${filepath}"`, error)
      return false
    }
  }

  // Remove covers that dont have the same filename as the new cover
  async removeOldCovers(dirpath: string, newCoverExt: string) {
    var filesInDir = await this.getFilesInDirectory(dirpath)

    const imageExtensions = ['.jpeg', '.jpg', '.png', '.webp', '.jiff']
    for (let i = 0; i < filesInDir.length; i++) {
      var file = filesInDir[i]
      var _extname = Path.extname(file).toLowerCase()
      var _filename = Path.basename(file, _extname).toLowerCase()
      if (_filename === 'cover' && _extname !== newCoverExt && imageExtensions.includes(_extname)) {
        var filepath = Path.join(dirpath, file)
        Logger.debug(`[CoverManager] Removing old cover from metadata "${filepath}"`)
        await this.removeFile(filepath)
      }
    }
  }

  async checkFileIsValidImage(imagepath: string, removeOnInvalid = false): Promise<ImageTypeResult> {
    const buffer: Buffer = await readChunk(imagepath, 0, 12)
    // The vendored image-type returns the detected type ({ ext, mime }) or null
    const imgType: { ext: string; mime: string } | null = imageType(buffer)
    if (!imgType) {
      if (removeOnInvalid) await this.removeFile(imagepath)
      return {
        error: 'Invalid image'
      }
    }

    if (!globals.SupportedImageTypes.includes(imgType.ext)) {
      if (removeOnInvalid) await this.removeFile(imagepath)
      return {
        error: `Invalid image type ${imgType.ext} (Supported: ${globals.SupportedImageTypes.join(',')})`
      }
    }
    return imgType
  }

  /**
   * @param coverFile - file object from req.files
   */
  async uploadCover(libraryItem: LibraryItem, coverFile: UploadedCoverFile): Promise<CoverResult> {
    const extname = Path.extname(coverFile.name.toLowerCase())
    if (!extname || !globals.SupportedImageTypes.includes(extname.slice(1))) {
      return {
        error: `Invalid image type ${extname} (Supported: ${globals.SupportedImageTypes.join(',')})`
      }
    }

    const coverDirPath = this.getCoverDirectory(libraryItem)
    await fs.ensureDir(coverDirPath)

    const coverFullPath = Path.posix.join(coverDirPath, `cover${extname}`)

    // Move cover from temp upload dir to destination
    const success = await coverFile
      .mv(coverFullPath)
      .then(() => true)
      .catch((error: Error) => {
        Logger.error('[CoverManager] Failed to move cover file', coverFullPath, error)
        return false
      })

    if (!success) {
      return {
        error: 'Failed to move cover into destination'
      }
    }

    await this.removeOldCovers(coverDirPath, extname)
    await CacheManager.purgeCoverCache(libraryItem.id)

    Logger.info(`[CoverManager] Uploaded libraryItem cover "${coverFullPath}" for "${libraryItem.media.title}"`)

    return {
      cover: coverFullPath
    }
  }

  async validateCoverPath(coverPath: string, libraryItem: LibraryItem): Promise<{ error: string; cover?: undefined } | { cover: string; updated: boolean; error?: undefined }> {
    // Invalid cover path
    if (!coverPath || coverPath.startsWith('http:') || coverPath.startsWith('https:')) {
      Logger.error(`[CoverManager] validate cover path invalid http url "${coverPath}"`)
      return {
        error: 'Invalid cover path'
      }
    }
    coverPath = filePathToPOSIX(coverPath)

    // Must already have been scanned in for the library item
    const isLibraryItemFile = libraryItem.libraryFiles?.some((lf) => filePathToPOSIX(lf.metadata?.path) === coverPath)
    if (!isLibraryItemFile) {
      Logger.error(`[CoverManager] validate cover path is not a library item file "${coverPath}"`)
      return {
        error: 'Invalid cover path'
      }
    }

    // Cover path already set on media
    if (libraryItem.media.coverPath == coverPath) {
      Logger.debug(`[CoverManager] validate cover path already set "${coverPath}"`)
      return {
        cover: coverPath,
        updated: false
      }
    }

    // Cover path does not exist
    if (!(await fs.pathExists(coverPath))) {
      Logger.error(`[CoverManager] validate cover path does not exist "${coverPath}"`)
      return {
        error: 'Cover path does not exist'
      }
    }

    // Cover path is not a file
    if (!(await checkPathIsFile(coverPath))) {
      Logger.error(`[CoverManager] validate cover path is not a file "${coverPath}"`)
      return {
        error: 'Cover path is not a file'
      }
    }

    // Check valid image at path
    var imgtype = await this.checkFileIsValidImage(coverPath, false)
    if (imgtype.error) {
      return imgtype
    }

    var coverDirPath = this.getCoverDirectory(libraryItem)

    // Cover path is not in correct directory - make a copy
    if (!coverPath.startsWith(coverDirPath)) {
      await fs.ensureDir(coverDirPath)

      var coverFilename = `cover.${imgtype.ext}`
      var newCoverPath = Path.posix.join(coverDirPath, coverFilename)
      Logger.debug(`[CoverManager] validate cover path copy cover from "${coverPath}" to "${newCoverPath}"`)

      var copySuccess = await fs
        .copy(coverPath, newCoverPath, { overwrite: true })
        .then(() => true)
        .catch((error: Error) => {
          Logger.error(`[CoverManager] validate cover path failed to copy cover`, error)
          return false
        })
      if (!copySuccess) {
        return {
          error: 'Failed to copy cover to dir'
        }
      }
      await this.removeOldCovers(coverDirPath, '.' + imgtype.ext)
      Logger.debug(`[CoverManager] cover copy success`)
      coverPath = newCoverPath
    }

    await CacheManager.purgeCoverCache(libraryItem.id)

    return {
      cover: coverPath,
      updated: true
    }
  }

  /**
   * Extract cover art from audio file and save for library item
   *
   * @param [libraryItemPath] null for isFile library items
   * @returns returns cover path
   */
  async saveEmbeddedCoverArt(audioFiles: (AudioFile | AudioFileObject)[], libraryItemId: string, libraryItemPath?: string | null): Promise<string | null> {
    let audioFileWithCover = audioFiles.find((af) => af.embeddedCoverArt)
    if (!audioFileWithCover) return null

    let coverDirPath = null
    if (global.ServerSettings.storeCoverWithItem && libraryItemPath) {
      coverDirPath = libraryItemPath
    } else {
      coverDirPath = Path.posix.join(global.MetadataPath, 'items', libraryItemId)
    }
    await fs.ensureDir(coverDirPath)

    const coverFilename = audioFileWithCover.embeddedCoverArt === 'png' ? 'cover.png' : 'cover.jpg'
    const coverFilePath = Path.join(coverDirPath, coverFilename)

    const coverAlreadyExists = await fs.pathExists(coverFilePath)
    if (coverAlreadyExists) {
      Logger.warn(`[CoverManager] Extract embedded cover art but cover already exists for "${coverFilePath}" - bail`)
      return null
    }

    // cast(d): scanned and stored audio files have a path
    const success = await extractCoverArt(audioFileWithCover.metadata.path!, coverFilePath)
    if (success) {
      await CacheManager.purgeCoverCache(libraryItemId)
      return coverFilePath
    }
    return null
  }

  /**
   * Extract cover art from ebook and save for library item
   *
   * @param [libraryItemPath] null for isFile library items
   * @returns returns cover path
   */
  async saveEbookCoverArt(ebookFileScanData: EBookFileScanData | null | undefined, libraryItemId: string, libraryItemPath?: string | null): Promise<string | null> {
    if (!ebookFileScanData?.ebookCoverPath) return null

    let coverDirPath = null
    if (global.ServerSettings.storeCoverWithItem && libraryItemPath) {
      coverDirPath = libraryItemPath
    } else {
      coverDirPath = Path.posix.join(global.MetadataPath, 'items', libraryItemId)
    }
    await fs.ensureDir(coverDirPath)

    let extname = Path.extname(ebookFileScanData.ebookCoverPath) || '.jpg'
    if (extname === '.jpeg') extname = '.jpg'
    const coverFilename = `cover${extname}`
    const coverFilePath = Path.join(coverDirPath, coverFilename)

    // TODO: Overwrite if exists?
    const coverAlreadyExists = await fs.pathExists(coverFilePath)
    if (coverAlreadyExists) {
      Logger.warn(`[CoverManager] Extract embedded cover art but cover already exists for "${coverFilePath}" - overwriting`)
    }

    const success = await parseEbookMetadata.extractCoverImage(ebookFileScanData, coverFilePath)
    if (success) {
      await CacheManager.purgeCoverCache(libraryItemId)
      return coverFilePath
    }
    return null
  }

  /**
   * @param [libraryItemPath] - null if library item isFile
   * @param [forceLibraryItemFolder=false] - force save cover with library item (used for adding new podcasts)
   */
  async downloadCoverFromUrlNew(url: string, libraryItemId: string, libraryItemPath?: string | null, forceLibraryItemFolder = false): Promise<CoverResult> {
    try {
      let coverDirPath = null
      if ((global.ServerSettings.storeCoverWithItem || forceLibraryItemFolder) && libraryItemPath) {
        coverDirPath = libraryItemPath
      } else {
        coverDirPath = Path.posix.join(global.MetadataPath, 'items', libraryItemId)
      }

      await fs.ensureDir(coverDirPath)

      const temppath = Path.posix.join(coverDirPath, 'cover')
      const success = await downloadImageFile(url, temppath)
        .then(() => true)
        .catch((err: Error) => {
          Logger.error(`[CoverManager] Download image file failed for "${url}"`, err)
          return false
        })
      if (!success) {
        return {
          error: 'Failed to download image from url'
        }
      }

      const imgtype = await this.checkFileIsValidImage(temppath, true)
      if (imgtype.error) {
        return imgtype
      }

      const coverFullPath = Path.posix.join(coverDirPath, `cover.${imgtype.ext}`)
      await fs.rename(temppath, coverFullPath)

      await this.removeOldCovers(coverDirPath, '.' + imgtype.ext)
      await CacheManager.purgeCoverCache(libraryItemId)

      Logger.info(`[CoverManager] Downloaded libraryItem cover "${coverFullPath}" from url "${url}"`)
      return {
        cover: coverFullPath
      }
    } catch (error) {
      Logger.error(`[CoverManager] Fetch cover image from url "${url}" failed`, error)
      return {
        error: 'Failed to fetch image from url'
      }
    }
  }
}
export = new CoverManager()
