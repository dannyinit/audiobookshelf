import parseEpubMetadata = require('./parseEpubMetadata')
import parseComicMetadata = require('./parseComicMetadata')
import type { EBookFileObject, EBookFileScanData } from './types'

/**
 * Parse metadata from ebook file
 */
async function parse(ebookFile: EBookFileObject | null | undefined): Promise<EBookFileScanData | null> {
  if (!ebookFile) return null

  if (ebookFile.ebookFormat === 'epub') {
    return parseEpubMetadata.parse(ebookFile)
  } else if (['cbz', 'cbr'].includes(ebookFile.ebookFormat)) {
    return parseComicMetadata.parse(ebookFile)
  }
  return null
}

/**
 * Extract cover from ebook file
 */
async function extractCoverImage(ebookFileScanData: EBookFileScanData | null | undefined, outputCoverPath: string): Promise<boolean> {
  if (!ebookFileScanData?.ebookCoverPath) return false

  if (ebookFileScanData.ebookFormat === 'epub') {
    return parseEpubMetadata.extractCoverImage(ebookFileScanData.path, ebookFileScanData.ebookCoverPath, outputCoverPath)
  } else if (['cbz', 'cbr'].includes(ebookFileScanData.ebookFormat)) {
    return parseComicMetadata.extractCoverImage(ebookFileScanData.path, ebookFileScanData.ebookCoverPath, outputCoverPath)
  }
  return false
}

export = {
  parse,
  extractCoverImage
}