import parseNfoMetadataModule = require('../utils/parsers/parseNfoMetadata')
import fileUtils = require('../utils/fileUtils')
import type LibraryFile = require('../objects/files/LibraryFile')
import type { LibraryFileObject } from '../models/types'
import type { BookMetadataObject } from './types'
import dynamicKey = require('./dynamicKey')
const { getKey, setKey } = dynamicKey
const { parseNfoMetadata } = parseNfoMetadataModule
const { readTextFile } = fileUtils

class NfoFileScanner {
  constructor() {}

  /**
   * Parse metadata from .nfo file found in library scan and update bookMetadata
   */
  async scanBookNfoFile(nfoLibraryFileObj: LibraryFile | LibraryFileObject, bookMetadata: BookMetadataObject) {
    // cast(d): scanned library files have a path (set by setDataFromPath)
    const nfoText = await readTextFile(nfoLibraryFileObj.metadata.path!)
    const nfoMetadata = nfoText ? await parseNfoMetadata(nfoText) : null
    if (nfoMetadata) {
      for (const key in nfoMetadata) {
        if (key === 'tags') {
          // Add tags only if tags are empty
          // cast(d): the key is in the parsed metadata (for...in over it)
          if (nfoMetadata.tags!.length) {
            // cast(d): the key is in the parsed metadata (for...in over it)
            bookMetadata.tags = nfoMetadata.tags!
          }
        } else if (key === 'genres') {
          // Add genres only if genres are empty
          // cast(d): the key is in the parsed metadata (for...in over it)
          if (nfoMetadata.genres!.length) {
            // cast(d): the key is in the parsed metadata (for...in over it)
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
        } else if (getKey(nfoMetadata, key) && key !== 'sequence') {
          setKey(bookMetadata, key, getKey(nfoMetadata, key))
        }
      }
    }
  }
}
export = new NfoFileScanner()
