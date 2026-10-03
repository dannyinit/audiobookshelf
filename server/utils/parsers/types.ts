/**
 * Types shared by the ebook metadata parsers.
 */
import parseOpfMetadata = require('./parseOpfMetadata')
import parseComicInfoMetadata = require('./parseComicInfoMetadata')

/**
 * Ebook file as stored on the Book model (see models/Book EBookFileObject)
 */
export type EBookFileObject = import('../../models/Book').EBookFileObject

/**
 * Metadata parsed from an epub OPF package document or a comic ComicInfo.xml
 */
export type EBookMetadata = NonNullable<ReturnType<typeof parseOpfMetadata.parseOpfMetadataJson>> | ReturnType<typeof parseComicInfoMetadata.parse>

export interface EBookFileScanData {
  path: string
  ebookFormat: string
  /** internal image path */
  ebookCoverPath?: string
  metadata: EBookMetadata
}
