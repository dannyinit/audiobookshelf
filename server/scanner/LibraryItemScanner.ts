import Path = require('path')
import constants = require('../utils/constants')

import fileUtils = require('../utils/fileUtils')
import scanUtils = require('../utils/scandir')
import libraryFilters = require('../utils/queries/libraryFilters')
import Logger = require('../Logger')
import Database = require('../Database')
import Watcher = require('../Watcher')
// Only used as a type; required for its side effects so the module load order stays as in the JS
import './LibraryScan'
import type LibraryScan = require('./LibraryScan')
import LibraryItemScanData = require('./LibraryItemScanData')
import BookScanner = require('./BookScanner')
import PodcastScanner = require('./PodcastScanner')
import ScanLogger = require('./ScanLogger')
// Only used as a type; required for its side effects so the module load order stays as in the JS
import '../models/LibraryItem'
import type LibraryItem = require('../models/LibraryItem')
import LibraryFile = require('../objects/files/LibraryFile')
import SocketAuthority = require('../SocketAuthority')
import type Library = require('../models/Library')
import type LibraryFolder = require('../models/LibraryFolder')
import type { LibrarySettingsObject } from '../models/types'
const { LogLevel, ScanResult } = constants

/**
 * Details of a library item folder that the watcher found renamed or moved (LibraryScanner passes {} when nothing moved)
 */
interface UpdateLibraryItemDetails {
  relPath: string
  path: string
  libraryFolderId?: string
  isFile?: boolean
}

class LibraryItemScanner {
  constructor() {}

  /**
   * Scan single library item
   *
   * @param [updateLibraryItemDetails] used by watcher when item folder was renamed
   * @returns ScanResult
   */
  async scanLibraryItem(libraryItemId: string, updateLibraryItemDetails: Partial<UpdateLibraryItemDetails> | null = null): Promise<number> {
    // TODO: Add task manager
    const libraryItem = await Database.libraryItemModel.findByPk(libraryItemId)
    if (!libraryItem) {
      Logger.error(`[LibraryItemScanner] Library item not found "${libraryItemId}"`)
      return ScanResult.NOTHING
    }

    const libraryFolderId = updateLibraryItemDetails?.libraryFolderId || libraryItem.libraryFolderId
    const library = await Database.libraryModel.findByPk(libraryItem.libraryId, {
      include: {
        model: Database.libraryFolderModel,
        where: {
          id: libraryFolderId
        }
      }
    })
    if (!library) {
      Logger.error(`[LibraryItemScanner] Library "${libraryItem.libraryId}" not found for library item "${libraryItem.id}"`)
      return ScanResult.NOTHING
    }

    // Make sure library filter data is set
    //   this is used to check for existing authors & series
    await libraryFilters.getFilterData(library.mediaType, library.id)

    const scanLogger = new ScanLogger()
    scanLogger.verbose = true
    scanLogger.setData('libraryItem', updateLibraryItemDetails?.relPath || libraryItem.relPath)

    const libraryItemPath = updateLibraryItemDetails?.path || fileUtils.filePathToPOSIX(libraryItem.path)
    // cast(b): the library folder is included in the query above; the association is optional in the model
    const folder = library.libraryFolders![0]
    const libraryItemScanData = await this.getLibraryItemScanData(libraryItemPath, library, folder, updateLibraryItemDetails?.isFile || false)

    let libraryItemDataUpdated = await libraryItemScanData.checkLibraryItemData(libraryItem, scanLogger)

    const { libraryItem: expandedLibraryItem, wasUpdated } = await this.rescanLibraryItemMedia(libraryItem, libraryItemScanData, library.settings, scanLogger)
    if (libraryItemDataUpdated || wasUpdated) {
      SocketAuthority.libraryItemEmitter('item_updated', expandedLibraryItem)

      await this.finalizeAuthorsAndSeriesFromScan(library.id, scanLogger)

      return ScanResult.UPDATED
    }

    scanLogger.addLog(LogLevel.DEBUG, `Library item is up-to-date`)
    return ScanResult.UPTODATE
  }

  /**
   * Emit author book count updates, then remove empty authors/series left after the scan
   */
  async finalizeAuthorsAndSeriesFromScan(libraryId: string, scanLogger: LibraryScan | ScanLogger) {
    await BookScanner.emitAuthorsNumBooksUpdated(libraryId, scanLogger)
    if (scanLogger.authorsRemovedFromBooks.length) {
      await BookScanner.checkAuthorsRemovedFromBooks(libraryId, scanLogger)
    }
    if (scanLogger.seriesRemovedFromBooks.length) {
      await BookScanner.checkSeriesRemovedFromBooks(libraryId, scanLogger)
    }
  }

  async getLibraryItemScanData(libraryItemPath: string, library: Library, folder: LibraryFolder, isSingleMediaItem: boolean): Promise<LibraryItemScanData> {
    const libraryFolderPath = fileUtils.filePathToPOSIX(folder.path)
    const libraryItemDir = libraryItemPath.replace(libraryFolderPath, '').slice(1)

    // Empty until it is set below (in both branches)
    let libraryItemData: ReturnType<typeof scanUtils.getDataFromMediaDir> | Record<string, never> = {}

    let fileItems: { fullpath: string; path: string }[] = []

    if (isSingleMediaItem) {
      // Single media item in root of folder
      fileItems = [
        {
          fullpath: libraryItemPath,
          path: libraryItemDir // actually the relPath (only filename here)
        }
      ]
      libraryItemData = {
        path: libraryItemPath, // full path
        relPath: libraryItemDir, // only filename
        mediaMetadata: {
          title: Path.basename(libraryItemDir, Path.extname(libraryItemDir))
        }
      }
    } else {
      fileItems = await fileUtils.recurseFiles(libraryItemPath)
      libraryItemData = scanUtils.getDataFromMediaDir(library.mediaType, libraryFolderPath, libraryItemDir)
    }

    const libraryFiles: LibraryFile[] = []
    for (let i = 0; i < fileItems.length; i++) {
      const fileItem = fileItems[i]

      if (Watcher.checkShouldIgnoreFilePath(fileItem.fullpath)) {
        // Skip file if it's pending
        Logger.info(`[LibraryItemScanner] Skipping watcher pending file "${fileItem.fullpath}" during scan of library item path "${libraryItemPath}"`)
        continue
      }

      const newLibraryFile = new LibraryFile()
      // fileItem.path is the relative path
      await newLibraryFile.setDataFromPath(fileItem.fullpath, fileItem.path)
      libraryFiles.push(newLibraryFile)
    }

    // NOTE: getFileTimestampsWithIno returns false when stat fails; the scan data then gets ino undefined and the timestamps 0
    // cast(c): read as in the JS (see NOTE above)
    const libraryItemStats = (await fileUtils.getFileTimestampsWithIno(libraryItemData.path)) as Exclude<Awaited<ReturnType<typeof fileUtils.getFileTimestampsWithIno>>, false>
    return new LibraryItemScanData({
      libraryFolderId: folder.id,
      libraryId: library.id,
      mediaType: library.mediaType,
      ino: libraryItemStats.ino,
      mtimeMs: libraryItemStats.mtimeMs || 0,
      ctimeMs: libraryItemStats.ctimeMs || 0,
      birthtimeMs: libraryItemStats.birthtimeMs || 0,
      path: libraryItemData.path,
      relPath: libraryItemData.relPath,
      isFile: isSingleMediaItem,
      mediaMetadata: libraryItemData.mediaMetadata || null,
      libraryFiles
    })
  }

  rescanLibraryItemMedia(existingLibraryItem: LibraryItem, libraryItemData: LibraryItemScanData, librarySettings: LibrarySettingsObject, libraryScan: LibraryScan | ScanLogger): Promise<{ libraryItem: LibraryItem; wasUpdated: boolean }> {
    if (existingLibraryItem.mediaType === 'book') {
      return BookScanner.rescanExistingBookLibraryItem(existingLibraryItem, libraryItemData, librarySettings, libraryScan)
    } else {
      return PodcastScanner.rescanExistingPodcastLibraryItem(existingLibraryItem, libraryItemData, librarySettings, libraryScan)
    }
  }

  async scanNewLibraryItem(libraryItemData: LibraryItemScanData, librarySettings: LibrarySettingsObject, libraryScan: LibraryScan | ScanLogger): Promise<LibraryItem | null> {
    let newLibraryItem: LibraryItem | null = null
    if (libraryItemData.mediaType === 'book') {
      newLibraryItem = await BookScanner.scanNewBookLibraryItem(libraryItemData, librarySettings, libraryScan)
    } else {
      newLibraryItem = await PodcastScanner.scanNewPodcastLibraryItem(libraryItemData, librarySettings, libraryScan)
    }
    if (newLibraryItem) {
      libraryScan.addLog(LogLevel.INFO, `Created new library item "${newLibraryItem.relPath}" with id "${newLibraryItem.id}"`)
    }
    return newLibraryItem
  }

  /**
   * Scan library item folder coming from Watcher
   * @returns ScanResult
   */
  async scanPotentialNewLibraryItem(libraryItemPath: string, library: Library, folder: LibraryFolder, isSingleMediaItem: boolean): Promise<LibraryItem | null> {
    const libraryItemScanData = await this.getLibraryItemScanData(libraryItemPath, library, folder, isSingleMediaItem)

    if (!libraryItemScanData.libraryFiles.length) {
      Logger.info(`[LibraryItemScanner] Library item at path "${libraryItemPath}" has no files - ignoring`)
      return null
    }

    const scanLogger = new ScanLogger()
    scanLogger.verbose = true
    scanLogger.setData('libraryItem', libraryItemScanData.relPath)

    const newLibraryItem = await this.scanNewLibraryItem(libraryItemScanData, library.settings, scanLogger)
    // Watcher path does not go through full-library scan cleanup — emit author book count updates here
    await BookScanner.emitAuthorsNumBooksUpdated(library.id, scanLogger)
    return newLibraryItem
  }
}
export = new LibraryItemScanner()
