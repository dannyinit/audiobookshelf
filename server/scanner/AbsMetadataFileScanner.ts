import Path = require('path')
import fsExtra = require('../libs/fsExtra')
import fileUtils = require('../utils/fileUtils')
import constants = require('../utils/constants')
import abmetadataGenerator = require('../utils/generators/abmetadataGenerator')
import type LibraryScan = require('./LibraryScan')
import type ScanLogger = require('./ScanLogger')
import type LibraryItemScanData = require('./LibraryItemScanData')
import type { BookMetadataObject, PodcastMetadataObject } from './types'
import dynamicKey = require('./dynamicKey')
const { setKey } = dynamicKey
const { readTextFile } = fileUtils
const { LogLevel } = constants

/**
 * Validated metadata.json values
 */
type AbMetadata = NonNullable<ReturnType<typeof abmetadataGenerator.parseJson>>

class AbsMetadataFileScanner {
  constructor() {}

  /**
   * Check for metadata.json file and set book metadata
   *
   * @param [existingLibraryItemId]
   */
  async scanBookMetadataFile(libraryScan: LibraryScan | ScanLogger, libraryItemData: LibraryItemScanData, bookMetadata: BookMetadataObject, existingLibraryItemId: string | null = null) {
    const metadataLibraryFile = libraryItemData.metadataJsonLibraryFile
    // Scanned library files have a path (set by setDataFromPath)
    let metadataText = metadataLibraryFile ? await readTextFile(metadataLibraryFile.metadata.path!) : null
    let metadataFilePath = metadataLibraryFile?.metadata.path

    // When metadata file is not stored with library item then check in the /metadata/items folder for it
    if (!metadataText && existingLibraryItemId) {
      let metadataPath = Path.join(global.MetadataPath, 'items', existingLibraryItemId)

      metadataFilePath = Path.join(metadataPath, 'metadata.json')
      if (await fsExtra.pathExists(metadataFilePath)) {
        metadataText = await readTextFile(metadataFilePath)
      }
    }

    if (metadataText) {
      libraryScan.addLog(LogLevel.INFO, `Found metadata file "${metadataFilePath}"`)
      const abMetadata: AbMetadata = abmetadataGenerator.parseJson(metadataText, 'book') || {}

      for (const key in abMetadata) {
        // TODO: When to override with null or empty arrays?
        if (abMetadata[key] === undefined || abMetadata[key] === null) continue
        if (key === 'authors' && !abMetadata.authors?.length) continue
        if (key === 'genres' && !abMetadata.genres?.length) continue
        if (key === 'tags' && !abMetadata.tags?.length) continue
        if (key === 'chapters' && !abMetadata.chapters?.length) continue

        setKey(bookMetadata, key, abMetadata[key])
      }
    }
  }

  /**
   * Check for metadata.json file and set podcast metadata
   *
   * @param [existingLibraryItemId]
   */
  async scanPodcastMetadataFile(libraryScan: LibraryScan | ScanLogger, libraryItemData: LibraryItemScanData, podcastMetadata: PodcastMetadataObject, existingLibraryItemId: string | null = null) {
    const metadataLibraryFile = libraryItemData.metadataJsonLibraryFile
    // Scanned library files have a path (set by setDataFromPath)
    let metadataText = metadataLibraryFile ? await readTextFile(metadataLibraryFile.metadata.path!) : null
    let metadataFilePath = metadataLibraryFile?.metadata.path

    // When metadata file is not stored with library item then check in the /metadata/items folder for it
    if (!metadataText && existingLibraryItemId) {
      let metadataPath = Path.join(global.MetadataPath, 'items', existingLibraryItemId)

      metadataFilePath = Path.join(metadataPath, 'metadata.json')
      if (await fsExtra.pathExists(metadataFilePath)) {
        metadataText = await readTextFile(metadataFilePath)
      }
    }

    if (metadataText) {
      libraryScan.addLog(LogLevel.INFO, `Found metadata file "${metadataFilePath}"`)
      const abMetadata: AbMetadata = abmetadataGenerator.parseJson(metadataText, 'podcast') || {}
      for (const key in abMetadata) {
        if (abMetadata[key] === undefined || abMetadata[key] === null) continue
        if (key === 'tags' && !abMetadata.tags?.length) continue

        setKey(podcastMetadata, key, abMetadata[key])
      }
    }
  }
}
export = new AbsMetadataFileScanner()
