import parseNfoMetadataModule = require('../utils/parsers/parseNfoMetadata')
import fileUtils = require('../utils/fileUtils')
import type LibraryFile = require('../objects/files/LibraryFile')
import type { LibraryFileObject } from '../models/types'
import type { BookMetadataObject } from './types'
const { parseNfoMetadata } = parseNfoMetadataModule
const { readTextFile } = fileUtils

class NfoFileScanner {
  constructor() {}

  /**
   * Parse metadata from .nfo file found in library scan and update bookMetadata
   */
  async scanBookNfoFile(nfoLibraryFileObj: LibraryFile | LibraryFileObject, bookMetadata: BookMetadataObject) {
    // Scanned library files have a path (set by setDataFromPath)
    const nfoText = await readTextFile(nfoLibraryFileObj.metadata.path!)
    const nfoMetadata = nfoText ? await parseNfoMetadata(nfoText) : null
    if (nfoMetadata) {
      for (const key in nfoMetadata) {
        if (key === 'tags') {
          // Add tags only if tags are empty
          // The key is in the parsed metadata
          if (nfoMetadata.tags!.length) {
            bookMetadata.tags = nfoMetadata.tags!
          }
        } else if (key === 'genres') {
          // Add genres only if genres are empty
          // The key is in the parsed metadata
          if (nfoMetadata.genres!.length) {
            bookMetadata.genres = nfoMetadata.genres!
          }
        } else if (key === 'authors') {
          if (nfoMetadata.authors?.length) {
            bookMetadata.authors = nfoMetadata.authors
          }
        } else if (key === 'narrators') {
          if (nfoMetadata.narrators?.length) {
            bookMetadata.narrators = nfoMetadata.narrators
          }
        } else if (key === 'series') {
          if (nfoMetadata.series) {
            bookMetadata.series = [
              {
                name: nfoMetadata.series,
                sequence: nfoMetadata.sequence || null
              }
            ]
          }
          // cast(d): dynamic metadata key
        } else if ((nfoMetadata as Record<string, unknown>)[key] && key !== 'sequence') {
          // cast(d): dynamic metadata key (both casts)
          (bookMetadata as Record<string, unknown>)[key] = (nfoMetadata as Record<string, unknown>)[key]
        }
      }
    }
  }
}
export = new NfoFileScanner()
