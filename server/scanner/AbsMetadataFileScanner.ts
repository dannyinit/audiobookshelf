import Path = require('path')
import fsExtra = require('../libs/fsExtra')
import { readTextFile } from '../utils/fileUtils'
import { LogLevel } from '../utils/constants'
import abmetadataGenerator = require('../utils/generators/abmetadataGenerator')

class AbsMetadataFileScanner {
  constructor() {}

  /**
   * Check for metadata.json file and set book metadata
   *
   * @param {import('./LibraryScan')} libraryScan
   * @param {import('./LibraryItemScanData')} libraryItemData
   * @param {Object} bookMetadata
   * @param {string} [existingLibraryItemId]
   */
  async scanBookMetadataFile(libraryScan: import('./LibraryScan'), libraryItemData: import('./LibraryItemScanData'), bookMetadata: object, existingLibraryItemId: string = null) {
    const metadataLibraryFile = libraryItemData.metadataJsonLibraryFile
    let metadataText = metadataLibraryFile ? await readTextFile(metadataLibraryFile.metadata.path) : null
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
      const abMetadata = abmetadataGenerator.parseJson(metadataText, 'book') || {}

      for (const key in abMetadata) {
        // TODO: When to override with null or empty arrays?
        if (abMetadata[key] === undefined || abMetadata[key] === null) continue
        if (key === 'authors' && !abMetadata.authors?.length) continue
        if (key === 'genres' && !abMetadata.genres?.length) continue
        if (key === 'tags' && !abMetadata.tags?.length) continue
        if (key === 'chapters' && !abMetadata.chapters?.length) continue

        bookMetadata[key] = abMetadata[key]
      }
    }
  }

  /**
   * Check for metadata.json file and set podcast metadata
   *
   * @param {import('./LibraryScan')} libraryScan
   * @param {import('./LibraryItemScanData')} libraryItemData
   * @param {Object} podcastMetadata
   * @param {string} [existingLibraryItemId]
   */
  async scanPodcastMetadataFile(libraryScan: import('./LibraryScan'), libraryItemData: import('./LibraryItemScanData'), podcastMetadata: object, existingLibraryItemId: string = null) {
    const metadataLibraryFile = libraryItemData.metadataJsonLibraryFile
    let metadataText = metadataLibraryFile ? await readTextFile(metadataLibraryFile.metadata.path) : null
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
      const abMetadata = abmetadataGenerator.parseJson(metadataText, 'podcast') || {}
      for (const key in abMetadata) {
        if (abMetadata[key] === undefined || abMetadata[key] === null) continue
        if (key === 'tags' && !abMetadata.tags?.length) continue

        podcastMetadata[key] = abMetadata[key]
      }
    }
  }
}
export = new AbsMetadataFileScanner()
