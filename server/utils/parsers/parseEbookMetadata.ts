import parseEpubMetadata = require('./parseEpubMetadata')
import parseComicMetadata = require('./parseComicMetadata')

type BookMetadataObject = import('../../scanner/BookScanner').BookMetadataObject

export interface EBookFileScanData {
  path: string
  ebookFormat: string
  /** internal image path, set when a cover image was found */
  ebookCoverPath?: string
  /** only the fields found in the ebook are set */
  metadata: { [K in keyof BookMetadataObject]?: BookMetadataObject[K] | null } | null
}


/**
 * Parse metadata from ebook file
 * 
 * @param {import('../../models/Book').EBookFileObject} ebookFile 
 * @returns {Promise<EBookFileScanData>}
 */
async function parse(ebookFile: import('../../models/Book').EBookFileObject): Promise<EBookFileScanData | null> {
  if (!ebookFile) return null

  if (ebookFile.ebookFormat === 'epub') {
    return parseEpubMetadata.parse(ebookFile)
  } else if (['cbz', 'cbr'].includes(ebookFile.ebookFormat)) {
    return parseComicMetadata.parse(ebookFile)
  }
  return null
}
export { parse }

/**
 * Extract cover from ebook file
 * 
 * @param {EBookFileScanData} ebookFileScanData 
 * @param {string} outputCoverPath 
 * @returns {Promise<boolean>}
 */
async function extractCoverImage(ebookFileScanData: EBookFileScanData, outputCoverPath: string): Promise<boolean> {
  if (!ebookFileScanData?.ebookCoverPath) return false

  if (ebookFileScanData.ebookFormat === 'epub') {
    return parseEpubMetadata.extractCoverImage(ebookFileScanData.path, ebookFileScanData.ebookCoverPath, outputCoverPath)
  } else if (['cbz', 'cbr'].includes(ebookFileScanData.ebookFormat)) {
    return parseComicMetadata.extractCoverImage(ebookFileScanData.path, ebookFileScanData.ebookCoverPath, outputCoverPath)
  }
  return false
}
export { extractCoverImage }