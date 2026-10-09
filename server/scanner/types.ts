/**
 * Types shared by the files in server/scanner.
 */
import type { ChapterObject } from '../models/types'
import type LibraryFile = require('../objects/files/LibraryFile')

/**
 * Library item object to create (LibraryItemScanData libraryItemObject); the book and podcast scanners set the id,
 * flags, titles and the nested book or podcast before they create the library item
 */
export interface NewLibraryItemObject {
  ino: string
  path: string
  relPath: string
  mediaType: string
  isFile: boolean
  mtime: number
  ctime: number
  birthtime: number
  lastScan: number
  lastScanVersion: string
  libraryFiles: LibraryFile[]
  libraryId: string
  libraryFolderId: string
  size: number
  id?: string
  isMissing?: boolean
  isInvalid?: boolean
  extraData?: object
  title?: string | null
  titleIgnorePrefix?: string
  authorNamesFirstLast?: string
  authorNamesLastFirst?: string
  book?: object
  podcast?: object
}

/**
 * Metadata for books pulled from files (built by BookScanner getBookMetadataFromScanData and filled in by the
 * metadata sources: folder names, audio meta tags, ebook, nfo, txt, opf and metadata.json)
 */
export type BookMetadataObject = {
  title: string
  titleIgnorePrefix?: string
  subtitle?: string | null
  publishedYear?: string | null
  publisher?: string | null
  description?: string | null
  isbn?: string | null
  asin?: string | null
  language?: string | null
  narrators: string[]
  genres: string[]
  tags: string[]
  authors: string[]
  series: { name: string; sequence: string | null }[]
  chapters: ChapterObject[]
  explicit?: boolean
  abridged?: boolean
  coverPath?: string | null
}

/**
 * Metadata for podcasts pulled from files (built by PodcastScanner getPodcastMetadataFromScanData)
 */
export type PodcastMetadataObject = {
  title: string
  titleIgnorePrefix?: string
  author?: string | null
  releaseDate?: string | null
  feedURL?: string | null
  imageURL?: string | null
  description?: string | null
  itunesPageURL?: string | null
  itunesId?: string | null
  itunesArtistId?: string | null
  language?: string | null
  podcastType?: string | null
  explicit?: boolean
  tags: string[]
  genres: string[]
  /** Set by scanNewPodcastLibraryItem from an image library file */
  coverPath?: string | null
}
