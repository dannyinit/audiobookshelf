import parseOpfMetadata = require('../utils/parsers/parseOpfMetadata')
import fileUtils = require('../utils/fileUtils')
import type LibraryFile = require('../objects/files/LibraryFile')
import type { LibraryFileObject } from '../models/types'
import type { BookMetadataObject } from './types'
import dynamicKey = require('./dynamicKey')
const { getKey, setKey } = dynamicKey
const { parseOpfMetadataXML } = parseOpfMetadata
const { readTextFile } = fileUtils

class OpfFileScanner {
  constructor() {}

  /**
   * Parse metadata from .opf file found in library scan and update bookMetadata
   */
  async scanBookOpfFile(opfLibraryFileObj: LibraryFile | LibraryFileObject, bookMetadata: BookMetadataObject) {
    // Scanned library files have a path (set by setDataFromPath)
    const xmlText = await readTextFile(opfLibraryFileObj.metadata.path!)
    const opfMetadata = xmlText ? await parseOpfMetadataXML(xmlText) : null
    if (opfMetadata) {
      for (const key in opfMetadata) {
        if (key === 'tags') {
          // Add tags only if tags are empty
          if (opfMetadata.tags.length) {
            bookMetadata.tags = opfMetadata.tags
          }
        } else if (key === 'genres') {
          // Add genres only if genres are empty
          if (opfMetadata.genres.length) {
            bookMetadata.genres = opfMetadata.genres
          }
        } else if (key === 'authors') {
          if (opfMetadata.authors?.length) {
            bookMetadata.authors = opfMetadata.authors
          }
        } else if (key === 'narrators') {
          if (opfMetadata.narrators?.length) {
            bookMetadata.narrators = opfMetadata.narrators
          }
        } else if (key === 'series') {
          if (opfMetadata.series?.length) {
            bookMetadata.series = opfMetadata.series
          }
        } else if (getKey(opfMetadata, key) && key !== 'sequence') {
          setKey(bookMetadata, key, getKey(opfMetadata, key))
        }
      }
    }
  }
}
export = new OpfFileScanner()
