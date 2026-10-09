import uuid = require('uuid')
import Path = require('path')
import sequelize = require('sequelize')
import constants = require('../utils/constants')
import utils = require('../utils/index')
import parseNameString = require('../utils/parsers/parseNameString')
import parseEbookMetadata = require('../utils/parsers/parseEbookMetadata')
import globals = require('../utils/globals')
import fileUtils = require('../utils/fileUtils')
import htmlSanitizer = require('../utils/htmlSanitizer')

import AudioFileScanner = require('./AudioFileScanner')
import Database = require('../Database')
import SocketAuthority = require('../SocketAuthority')
import BookFinder = require('../finders/BookFinder')
import fsExtra = require('../libs/fsExtra')
import EBookFile = require('../objects/files/EBookFile')
import AudioFile = require('../objects/files/AudioFile')
import LibraryFile = require('../objects/files/LibraryFile')

import RssFeedManager = require('../managers/RssFeedManager')
import CoverManager = require('../managers/CoverManager')

// Only used as a type; required for its side effects so the module load order stays as in the JS
import './LibraryScan'
import type LibraryScan = require('./LibraryScan')
import OpfFileScanner = require('./OpfFileScanner')
import NfoFileScanner = require('./NfoFileScanner')
import AbsMetadataFileScanner = require('./AbsMetadataFileScanner')
import type { CreationAttributes, Includeable } from 'sequelize'
import type LibraryItem = require('../models/LibraryItem')
import type Book = require('../models/Book')
import type ScanLogger = require('./ScanLogger')
import type LibraryItemScanData = require('./LibraryItemScanData')
import type { AudioFileObject, EBookFileObject, LibraryFileObject, LibrarySettingsObject } from '../models/types'
import type { EBookFileScanData, EBookMetadata } from '../utils/parsers/types'
import type { BookMetadataObject } from './types'
const uuidv4 = uuid.v4
const { LogLevel } = constants
const { getTitleIgnorePrefix, areEquivalent } = utils
const { readTextFile, filePathToPOSIX, getFileTimestampsWithIno } = fileUtils

/**
 * Audio files of a book: the stored JSON or scanned AudioFiles (see AudioFileScanner)
 */
type BookAudioFiles = Parameters<typeof AudioFileScanner.setBookMetadataFromAudioMetaTags>[1]

/**
 * Name of a metadata source method of BookMetadataSourceHandler (library setting metadataPrecedence)
 */
type MetadataSourceName = 'folderStructure' | 'audioMetatags' | 'nfoFile' | 'txtFiles' | 'opfFile' | 'absMetadata'

/**
 * Ebook library file JSON (LibraryFile toJSON) that becomes the book ebookFile once ebookFormat is set
 */
type EbookLibraryFileJson = ReturnType<LibraryFile['toJSON']> & { ebookFormat?: string }

/**
 * Book join row created with a new book: an existing author/series id, or a new author/series
 */
interface NewBookAuthor {
  authorId?: string
  createdAt?: number
  author?: { libraryId: string; name: string; lastFirst: string | null | undefined }
}
interface NewBookSeries {
  seriesId?: string
  sequence: string | null
  series?: { name: string; nameIgnorePrefix: string; libraryId: string }
}

/**
 * Book object created with a new library item
 */
type NewBookObject = BookMetadataObject & {
  audioFiles: AudioFile[]
  ebookFile: LibraryFile | EbookLibraryFileJson | null
  duration: number
  bookAuthors: NewBookAuthor[]
  bookSeries: NewBookSeries[]
}

/**
 * The ebook metadata fields the audioMetatags source reads by name (opf or comic info metadata)
 */
interface EbookMetadataFields {
  tags?: string[]
  genres?: string[]
  authors?: string[]
  narrators?: string[]
  series?: BookMetadataObject['series']
}

class BookScanner {
  constructor() {}

  async rescanExistingBookLibraryItem(existingLibraryItem: LibraryItem, libraryItemData: LibraryItemScanData, librarySettings: LibrarySettingsObject, libraryScan: LibraryScan | ScanLogger): Promise<{ libraryItem: LibraryItem; wasUpdated: boolean }> {
    // cast(d): the media of a book library item is a book (with its authors and series included)
    const media = (await existingLibraryItem.getMedia({
      include: [
        {
          model: Database.authorModel,
          through: {
            attributes: ['id', 'createdAt']
          }
        },
        {
          model: Database.seriesModel,
          through: {
            attributes: ['id', 'sequence', 'createdAt']
          }
        }
      ],
      order: [
        [Database.authorModel, Database.bookAuthorModel, 'createdAt', 'ASC'],
        [Database.seriesModel, 'bookSeries', 'createdAt', 'ASC']
      ]
    })) as Book

    let hasMediaChanges = libraryItemData.hasAudioFileChanges || libraryItemData.audioLibraryFiles.length !== media.audioFiles.length
    if (hasMediaChanges) {
      // Filter out audio files that were removed
      media.audioFiles = media.audioFiles.filter((af) => !libraryItemData.checkAudioFileRemoved(af))

      // Update audio files that were modified
      if (libraryItemData.audioLibraryFilesModified.length) {
        let scannedAudioFiles = await AudioFileScanner.executeMediaFileScans(
          existingLibraryItem.mediaType,
          libraryItemData,
          libraryItemData.audioLibraryFilesModified.map((lf) => lf.new)
        )
        media.audioFiles = media.audioFiles.map((audioFileObj) => {
          let matchedScannedAudioFile = scannedAudioFiles.find((saf) => saf.metadata.path === audioFileObj.metadata.path)
          if (!matchedScannedAudioFile) {
            matchedScannedAudioFile = scannedAudioFiles.find((saf) => saf.ino === audioFileObj.ino)
          }

          if (matchedScannedAudioFile) {
            scannedAudioFiles = scannedAudioFiles.filter((saf) => saf !== matchedScannedAudioFile)
            const audioFile = new AudioFile(audioFileObj)
            audioFile.updateFromScan(matchedScannedAudioFile)
            // cast(d): the stored audio file JSON (AudioFile toJSON)
            return audioFile.toJSON() as AudioFileObject
          }
          return audioFileObj
        })
        // Modified audio files that were not found on the book
        if (scannedAudioFiles.length) {
          // cast(d): the scanned AudioFile objects are stored in the audio files JSON column (sequelize serializes them with toJSON), as in the JS
          media.audioFiles.push(...(scannedAudioFiles as AudioFileObject[]))
        }
      }

      // Add new audio files scanned in
      if (libraryItemData.audioLibraryFilesAdded.length) {
        const scannedAudioFiles = await AudioFileScanner.executeMediaFileScans(existingLibraryItem.mediaType, libraryItemData, libraryItemData.audioLibraryFilesAdded)
        // cast(d): the scanned AudioFile objects are stored in the audio files JSON column (sequelize serializes them with toJSON), as in the JS
        media.audioFiles.push(...(scannedAudioFiles as AudioFileObject[]))
      }

      // Add audio library files that are not already set on the book (safety check)
      let audioLibraryFilesToAdd: LibraryFile[] = []
      for (const audioLibraryFile of libraryItemData.audioLibraryFiles) {
        if (!media.audioFiles.some((af) => af.ino === audioLibraryFile.ino)) {
          libraryScan.addLog(LogLevel.DEBUG, `Existing audio library file "${audioLibraryFile.metadata.relPath}" was not set on book "${media.title}" so setting it now`)

          audioLibraryFilesToAdd.push(audioLibraryFile)
        }
      }
      if (audioLibraryFilesToAdd.length) {
        const scannedAudioFiles = await AudioFileScanner.executeMediaFileScans(existingLibraryItem.mediaType, libraryItemData, audioLibraryFilesToAdd)
        // cast(d): the scanned AudioFile objects are stored in the audio files JSON column (sequelize serializes them with toJSON), as in the JS
        media.audioFiles.push(...(scannedAudioFiles as AudioFileObject[]))
      }

      media.audioFiles = AudioFileScanner.runSmartTrackOrder(existingLibraryItem.relPath, media.audioFiles)

      media.duration = 0
      media.audioFiles.forEach((af) => {
        if (!isNaN(af.duration)) {
          media.duration += af.duration
        }
      })

      media.changed('audioFiles', true)
    }

    // Check if cover was removed
    if (media.coverPath && libraryItemData.imageLibraryFilesRemoved.some((lf) => lf.metadata.path === media.coverPath) && !(await fsExtra.pathExists(media.coverPath))) {
      media.coverPath = null
      hasMediaChanges = true
    }

    // Update cover if it was modified
    if (media.coverPath && libraryItemData.imageLibraryFilesModified.length) {
      let coverMatch = libraryItemData.imageLibraryFilesModified.find((iFile) => iFile.old.metadata.path === media.coverPath)
      if (coverMatch) {
        const coverPath = coverMatch.new.metadata.path
        if (coverPath !== media.coverPath) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book cover "${media.coverPath}" => "${coverPath}" for book "${media.title}"`)
          media.coverPath = coverPath
          media.changed('coverPath', true)
          hasMediaChanges = true
        }
      }
    }

    // Check if cover is not set and image files were found
    if (!media.coverPath && libraryItemData.imageLibraryFiles.length) {
      // Prefer using a cover image with the name "cover" otherwise use the first image
      // Scanned library files have a path (set by setDataFromPath)
      const coverMatch = libraryItemData.imageLibraryFiles.find((iFile) => /\/cover\.[^.\/]*$/.test(iFile.metadata.path!))
      media.coverPath = coverMatch?.metadata.path || libraryItemData.imageLibraryFiles[0].metadata.path
      hasMediaChanges = true
    }

    // Check if ebook was removed
    if (media.ebookFile && (librarySettings.audiobooksOnly || libraryItemData.checkEbookFileRemoved(media.ebookFile))) {
      media.ebookFile = null
      hasMediaChanges = true
    }

    // Update ebook if it was modified
    if (media.ebookFile && libraryItemData.ebookLibraryFilesModified.length) {
      // ebookFile was checked above
      let ebookMatch = libraryItemData.ebookLibraryFilesModified.find((eFile) => eFile.old.metadata.path === media.ebookFile!.metadata.path)
      if (ebookMatch) {
        const ebookFile = new EBookFile(ebookMatch.new)
        // cast(d): the constructor sets metadata from the library file JSON, which has an extension (2 reads)
        ebookFile.ebookFormat = ebookFile.metadata!.ext!.slice(1).toLowerCase()
        libraryScan.addLog(LogLevel.DEBUG, `Updating book ebook file "${media.ebookFile.metadata.path}" => "${ebookFile.metadata!.path}" for book "${media.title}"`)
        // cast(d): the stored ebook file JSON (EBookFile toJSON; ebookFormat was set just above)
        media.ebookFile = ebookFile.toJSON() as EBookFileObject
        media.changed('ebookFile', true)
        hasMediaChanges = true
      }
    }

    // Check if ebook is not set and ebooks were found
    if (!media.ebookFile && !librarySettings.audiobooksOnly && libraryItemData.ebookLibraryFiles.length) {
      // Prefer to use an epub ebook then fallback to the first ebook found
      // Scanned library files have an extension (set by setDataFromPath)
      let ebookLibraryFile: LibraryFile | EbookLibraryFileJson | undefined = libraryItemData.ebookLibraryFiles.find((lf) => lf.metadata.ext!.slice(1).toLowerCase() === 'epub')
      if (!ebookLibraryFile) ebookLibraryFile = libraryItemData.ebookLibraryFiles[0]
      ebookLibraryFile = ebookLibraryFile.toJSON()
      // Ebook file is the same as library file except for additional `ebookFormat`
      ebookLibraryFile.ebookFormat = ebookLibraryFile.metadata.ext.slice(1).toLowerCase()
      // cast(d): ebookFormat was set just above
      media.ebookFile = ebookLibraryFile as EBookFileObject
      media.changed('ebookFile', true)
      hasMediaChanges = true
    }

    const ebookFileScanData = await parseEbookMetadata.parse(media.ebookFile)

    const bookMetadata = await this.getBookMetadataFromScanData(media.audioFiles, ebookFileScanData, libraryItemData, libraryScan, librarySettings, existingLibraryItem.id)
    let authorsUpdated = false
    const bookAuthorsRemoved = []
    let seriesUpdated = false
    const bookSeriesRemoved = []

    for (const key in bookMetadata) {
      // Ignore unset metadata and empty arrays
      // cast(d): dynamic metadata key (all 4 casts)
      if ((bookMetadata as Record<string, unknown>)[key] === undefined || (Array.isArray((bookMetadata as Record<string, unknown>)[key]) && !((bookMetadata as Record<string, unknown>)[key] as unknown[]).length)) continue

      if (key === 'authors') {
        // Check for authors added
        for (const authorName of bookMetadata.authors) {
          if (!media.authors.some((au) => au.name === authorName)) {
            const existingAuthorId = await Database.getAuthorIdByName(libraryItemData.libraryId, authorName)
            if (existingAuthorId) {
              await Database.bookAuthorModel.create({
                bookId: media.id,
                authorId: existingAuthorId
              })
              libraryScan.authorsNumBooksChangedIds.add(existingAuthorId)
              libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" added author "${authorName}"`)
              authorsUpdated = true
            } else {
              const newAuthor = await Database.authorModel.create({
                name: authorName,
                lastFirst: Database.authorModel.getLastFirst(authorName),
                libraryId: libraryItemData.libraryId
              })
              await media.addAuthor(newAuthor)
              Database.addAuthorToFilterData(libraryItemData.libraryId, newAuthor.name, newAuthor.id)
              SocketAuthority.emitter('author_added', newAuthor.toOldJSON())
              libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" added new author "${authorName}"`)
              authorsUpdated = true
            }
          }
        }
        // Check for authors removed
        for (const author of media.authors) {
          if (!bookMetadata.authors.includes(author.name)) {
            await author.bookAuthor.destroy()
            libraryScan.authorsNumBooksChangedIds.add(author.id)
            libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" removed author "${author.name}"`)
            authorsUpdated = true
            bookAuthorsRemoved.push(author.id)
          }
        }
      } else if (key === 'series') {
        // Check for series added
        for (const seriesObj of bookMetadata.series) {
          const existingBookSeries = media.series.find((se) => se.name === seriesObj.name)
          if (!existingBookSeries) {
            const existingSeriesId = await Database.getSeriesIdByName(libraryItemData.libraryId, seriesObj.name)
            if (existingSeriesId) {
              await Database.bookSeriesModel.create({
                bookId: media.id,
                seriesId: existingSeriesId,
                sequence: seriesObj.sequence
              })
              libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" added series "${seriesObj.name}"${seriesObj.sequence ? ` with sequence "${seriesObj.sequence}"` : ''}`)
              seriesUpdated = true
            } else {
              const newSeries = await Database.seriesModel.create({
                name: seriesObj.name,
                nameIgnorePrefix: getTitleIgnorePrefix(seriesObj.name),
                libraryId: libraryItemData.libraryId
              })
              await media.addSeries(newSeries, { through: { sequence: seriesObj.sequence } })
              Database.addSeriesToFilterData(libraryItemData.libraryId, newSeries.name, newSeries.id)
              libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" added new series "${seriesObj.name}"${seriesObj.sequence ? ` with sequence "${seriesObj.sequence}"` : ''}`)
              seriesUpdated = true
            }
          } else if (seriesObj.sequence && existingBookSeries.bookSeries.sequence !== seriesObj.sequence) {
            libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" series "${seriesObj.name}" sequence "${existingBookSeries.bookSeries.sequence || ''}" => "${seriesObj.sequence}"`)
            seriesUpdated = true
            existingBookSeries.bookSeries.sequence = seriesObj.sequence
            await existingBookSeries.bookSeries.save()
          }
        }
        // Check for series removed
        for (const series of media.series) {
          if (!bookMetadata.series.some((se) => se.name === series.name)) {
            await series.bookSeries.destroy()
            libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" removed series "${series.name}"`)
            seriesUpdated = true
            bookSeriesRemoved.push(series.id)
          }
        }
      } else if (key === 'genres') {
        const existingGenres = media.genres || []
        if (bookMetadata.genres.some((g) => !existingGenres.includes(g)) || existingGenres.some((g) => !bookMetadata.genres.includes(g))) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book genres "${existingGenres.join(',')}" => "${bookMetadata.genres.join(',')}" for book "${bookMetadata.title}"`)
          media.genres = bookMetadata.genres
          hasMediaChanges = true
        }
      } else if (key === 'tags') {
        const existingTags = media.tags || []
        if (bookMetadata.tags.some((t) => !existingTags.includes(t)) || existingTags.some((t) => !bookMetadata.tags.includes(t))) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book tags "${existingTags.join(',')}" => "${bookMetadata.tags.join(',')}" for book "${bookMetadata.title}"`)
          media.tags = bookMetadata.tags
          hasMediaChanges = true
        }
      } else if (key === 'narrators') {
        const existingNarrators = media.narrators || []
        if (bookMetadata.narrators.some((t) => !existingNarrators.includes(t)) || existingNarrators.some((t) => !bookMetadata.narrators.includes(t))) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book narrators "${existingNarrators.join(',')}" => "${bookMetadata.narrators.join(',')}" for book "${bookMetadata.title}"`)
          media.narrators = bookMetadata.narrators
          hasMediaChanges = true
        }
      } else if (key === 'chapters') {
        if (!areEquivalent(media.chapters, bookMetadata.chapters)) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book chapters for book "${bookMetadata.title}"`)
          media.chapters = bookMetadata.chapters
          hasMediaChanges = true
        }
      } else if (key === 'coverPath') {
        if (media.coverPath && media.coverPath !== bookMetadata.coverPath && !(await fsExtra.pathExists(media.coverPath))) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book cover "${media.coverPath}" => "${bookMetadata.coverPath}" for book "${bookMetadata.title}" - original cover path does not exist`)
          // Not undefined (skipped above); only set to an image file path
          media.coverPath = bookMetadata.coverPath!
          hasMediaChanges = true
        } else if (!media.coverPath) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book cover "unset" => "${bookMetadata.coverPath}" for book "${bookMetadata.title}"`)
          // Not undefined (skipped above); only set to an image file path
          media.coverPath = bookMetadata.coverPath!
          hasMediaChanges = true
        }
        // cast(d): dynamic metadata key (both casts)
      } else if ((bookMetadata as Record<string, unknown>)[key] !== (media as unknown as Record<string, unknown>)[key]) {
        // cast(d): dynamic metadata key (both casts)
        libraryScan.addLog(LogLevel.DEBUG, `Updating book ${key} "${(media as unknown as Record<string, unknown>)[key]}" => "${(bookMetadata as Record<string, unknown>)[key]}" for book "${bookMetadata.title}"`)
        // cast(d): dynamic metadata key (both casts; the metadata sources only set strings, booleans and the arrays handled above, matching the book fields)
        ;(media as unknown as Record<string, unknown>)[key] = (bookMetadata as Record<string, unknown>)[key]
        hasMediaChanges = true
      }
    }

    // Load authors/series again if updated (for sending back to client)
    if (authorsUpdated) {
      media.authors = await media.getAuthors({
        joinTableAttributes: ['createdAt'],
        order: [sequelize.literal(`bookAuthor.createdAt ASC`)]
      })
    }
    if (seriesUpdated) {
      media.series = await media.getSeries({
        joinTableAttributes: ['sequence', 'createdAt'],
        order: [sequelize.literal(`bookSeries.createdAt ASC`)]
      })
    }

    // If no cover then extract cover from audio file OR from ebook
    const libraryItemDir = existingLibraryItem.isFile ? null : existingLibraryItem.path
    if (!media.coverPath) {
      let extractedCoverPath = await CoverManager.saveEmbeddedCoverArt(media.audioFiles, existingLibraryItem.id, libraryItemDir)
      if (extractedCoverPath) {
        libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" extracted embedded cover art from audio file to path "${extractedCoverPath}"`)
        media.coverPath = extractedCoverPath
        hasMediaChanges = true
      } else if (ebookFileScanData?.ebookCoverPath) {
        extractedCoverPath = await CoverManager.saveEbookCoverArt(ebookFileScanData, existingLibraryItem.id, libraryItemDir)
        if (extractedCoverPath) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating book "${bookMetadata.title}" extracted embedded cover art from ebook file to path "${extractedCoverPath}"`)
          media.coverPath = extractedCoverPath
          hasMediaChanges = true
        }
      }
    }

    // If no cover then search for cover if enabled in server settings
    if (!media.coverPath && Database.serverSettings.scannerFindCovers) {
      const authorName = media.authors
        .map((au) => au.name)
        .filter((au) => au)
        .join(', ')
      // cast(d): a book without a title (null) is passed on to the cover search, as in the JS
      const coverPath = await this.searchForCover(existingLibraryItem.id, libraryItemDir, media.title as string, authorName, libraryScan)
      if (coverPath) {
        media.coverPath = coverPath
        hasMediaChanges = true
      }
    }

    existingLibraryItem.media = media

    let libraryItemUpdated = false

    // Save Book changes to db
    if (hasMediaChanges) {
      await media.save()
      // cast(d): this scanner only rescans book library items (media is the book set above)
      await this.saveMetadataFile(existingLibraryItem as LibraryItem.BookLibraryItem, libraryScan)
      libraryItemUpdated = global.ServerSettings.storeMetadataWithItem && !existingLibraryItem.isFile
    }

    // If book has no audio files and no ebook then it is considered missing
    if (!media.audioFiles.length && !media.ebookFile) {
      if (!existingLibraryItem.isMissing) {
        libraryScan.addLog(LogLevel.INFO, `Book "${bookMetadata.title}" has no audio files and no ebook file. Setting library item as missing`)
        existingLibraryItem.isMissing = true
        libraryItemUpdated = true
      }
    } else if (existingLibraryItem.isMissing) {
      libraryScan.addLog(LogLevel.INFO, `Book "${bookMetadata.title}" was missing but now has media files. Setting library item as NOT missing`)
      existingLibraryItem.isMissing = false
      libraryItemUpdated = true
    }

    // Check/update the isSupplementary flag on libraryFiles for the LibraryItem
    for (const libraryFile of existingLibraryItem.libraryFiles) {
      if (globals.SupportedEbookTypes.includes(libraryFile.metadata.ext.slice(1).toLowerCase())) {
        if (media.ebookFile && libraryFile.ino === media.ebookFile.ino) {
          if (libraryFile.isSupplementary !== false) {
            libraryFile.isSupplementary = false
            libraryItemUpdated = true
          }
        } else if (libraryFile.isSupplementary !== true) {
          libraryFile.isSupplementary = true
          libraryItemUpdated = true
        }
      }
    }
    if (libraryItemUpdated) {
      existingLibraryItem.changed('libraryFiles', true)
      await existingLibraryItem.save()
    }

    libraryScan.seriesRemovedFromBooks.push(...bookSeriesRemoved)
    libraryScan.authorsRemovedFromBooks.push(...bookAuthorsRemoved)

    return {
      libraryItem: existingLibraryItem,
      wasUpdated: hasMediaChanges || libraryItemUpdated || seriesUpdated || authorsUpdated
    }
  }

  async scanNewBookLibraryItem(libraryItemData: LibraryItemScanData, librarySettings: LibrarySettingsObject, libraryScan: LibraryScan | ScanLogger): Promise<LibraryItem | null> {
    // Scan audio files found
    let scannedAudioFiles = await AudioFileScanner.executeMediaFileScans(libraryItemData.mediaType, libraryItemData, libraryItemData.audioLibraryFiles)
    scannedAudioFiles = AudioFileScanner.runSmartTrackOrder(libraryItemData.relPath, scannedAudioFiles)

    // Find ebook file (prefer epub)
    // Scanned library files have an extension (set by setDataFromPath)
    let ebookLibraryFile: LibraryFile | EbookLibraryFileJson | null = librarySettings.audiobooksOnly ? null : libraryItemData.ebookLibraryFiles.find((lf) => lf.metadata.ext!.slice(1).toLowerCase() === 'epub') || libraryItemData.ebookLibraryFiles[0]

    // Do not add library items that have no valid audio files and no ebook file
    if (!ebookLibraryFile && !scannedAudioFiles.length) {
      libraryScan.addLog(LogLevel.WARN, `Library item at path "${libraryItemData.relPath}" has no audio files and no ebook file - ignoring`)
      return null
    }

    let ebookFileScanData: EBookFileScanData | null = null
    if (ebookLibraryFile) {
      ebookLibraryFile = ebookLibraryFile.toJSON()
      ebookLibraryFile.ebookFormat = ebookLibraryFile.metadata.ext.slice(1).toLowerCase()
      // cast(d): ebookFormat was set just above
      ebookFileScanData = await parseEbookMetadata.parse(ebookLibraryFile as EBookFileObject)
    }

    const bookMetadata = await this.getBookMetadataFromScanData(scannedAudioFiles, ebookFileScanData, libraryItemData, libraryScan, librarySettings)
    bookMetadata.explicit = !!bookMetadata.explicit // Ensure boolean
    bookMetadata.abridged = !!bookMetadata.abridged // Ensure boolean

    let duration = 0
    // cast(d): isNaN(null) is false and Number(null) adds 0, as in the JS
    scannedAudioFiles.forEach((af) => (duration += !isNaN(af.duration as number) ? Number(af.duration) : 0))
    const bookObject: NewBookObject = {
      ...bookMetadata,
      audioFiles: scannedAudioFiles,
      ebookFile: ebookLibraryFile || null,
      duration,
      bookAuthors: [],
      bookSeries: []
    }

    const createdAtTimestamp = new Date().getTime()
    const newAuthorNames = new Set()
    if (bookMetadata.authors.length) {
      for (const authorName of bookMetadata.authors) {
        const matchingAuthorId = await Database.getAuthorIdByName(libraryItemData.libraryId, authorName)
        if (matchingAuthorId) {
          bookObject.bookAuthors.push({
            authorId: matchingAuthorId
          })
          // Existing author — only numBooks changes; batch emit at scan end
          libraryScan.authorsNumBooksChangedIds.add(matchingAuthorId)
        } else {
          // New author
          bookObject.bookAuthors.push({
            // Ensures authors are in a set order
            createdAt: createdAtTimestamp + bookObject.bookAuthors.length,
            author: {
              libraryId: libraryItemData.libraryId,
              name: authorName,
              lastFirst: Database.authorModel.getLastFirst(authorName)
            }
          })
          newAuthorNames.add(authorName)
        }
      }
    }
    if (bookMetadata.series.length) {
      for (const seriesObj of bookMetadata.series) {
        if (!seriesObj.name) continue
        const matchingSeriesId = await Database.getSeriesIdByName(libraryItemData.libraryId, seriesObj.name)
        if (matchingSeriesId) {
          bookObject.bookSeries.push({
            seriesId: matchingSeriesId,
            sequence: seriesObj.sequence
          })
        } else {
          bookObject.bookSeries.push({
            sequence: seriesObj.sequence,
            series: {
              name: seriesObj.name,
              nameIgnorePrefix: getTitleIgnorePrefix(seriesObj.name),
              libraryId: libraryItemData.libraryId
            }
          })
        }
      }
    }

    const libraryItemObj = libraryItemData.libraryItemObject
    libraryItemObj.id = uuidv4() // Generate library item id ahead of time to use for saving extracted cover image
    libraryItemObj.isMissing = false
    libraryItemObj.isInvalid = false
    libraryItemObj.extraData = {}
    libraryItemObj.title = bookMetadata.title
    libraryItemObj.titleIgnorePrefix = getTitleIgnorePrefix(bookMetadata.title)
    libraryItemObj.authorNamesFirstLast = bookMetadata.authors.join(', ')
    libraryItemObj.authorNamesLastFirst = bookMetadata.authors.map((author) => Database.authorModel.getLastFirst(author)).join(', ')

    // Set isSupplementary flag on ebook library files
    for (const libraryFile of libraryItemObj.libraryFiles) {
      // Scanned library files have an extension (set by setDataFromPath)
      if (globals.SupportedEbookTypes.includes(libraryFile.metadata.ext!.slice(1).toLowerCase())) {
        libraryFile.isSupplementary = libraryFile.ino !== ebookLibraryFile?.ino
      }
    }

    // If cover was not found in folder then check embedded covers in audio files OR ebook file
    const libraryItemDir = libraryItemObj.isFile ? null : libraryItemObj.path
    if (!bookObject.coverPath) {
      let extractedCoverPath = await CoverManager.saveEmbeddedCoverArt(scannedAudioFiles, libraryItemObj.id, libraryItemDir)
      if (extractedCoverPath) {
        libraryScan.addLog(LogLevel.DEBUG, `Extracted embedded cover from audio file at "${extractedCoverPath}" for book "${bookObject.title}"`)
        bookObject.coverPath = extractedCoverPath
      } else if (ebookFileScanData?.ebookCoverPath) {
        extractedCoverPath = await CoverManager.saveEbookCoverArt(ebookFileScanData, libraryItemObj.id, libraryItemDir)
        if (extractedCoverPath) {
          libraryScan.addLog(LogLevel.DEBUG, `Extracted embedded cover from ebook file at "${extractedCoverPath}" for book "${bookObject.title}"`)
          bookObject.coverPath = extractedCoverPath
        }
      }
    }

    // If cover not found then search for cover if enabled in settings
    if (!bookObject.coverPath && Database.serverSettings.scannerFindCovers) {
      const authorName = bookMetadata.authors.join(', ')
      bookObject.coverPath = await this.searchForCover(libraryItemObj.id, libraryItemDir, bookObject.title, authorName, libraryScan)
    }

    libraryItemObj.book = bookObject
    // cast(b): created with the nested book, book series and book authors (the associations set the ids) and the scanned LibraryFile objects (serialized with toJSON)
    const libraryItem = await Database.libraryItemModel.create(libraryItemObj as unknown as CreationAttributes<LibraryItem>, {
      include: {
        model: Database.bookModel,
        include: [
          // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
          {
            model: Database.bookSeriesModel,
            include: {
              model: Database.seriesModel
            }
          } as unknown as Includeable,
          // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
          {
            model: Database.bookAuthorModel,
            include: {
              model: Database.authorModel
            }
          } as unknown as Includeable
        ]
      }
    })

    // Update library filter data
    // The book (with its join rows) is created with the library item (included above)
    if (libraryItem.book!.bookSeries?.length) {
      for (const bs of libraryItem.book!.bookSeries) {
        if (bs.series) {
          Database.addSeriesToFilterData(libraryItemData.libraryId, bs.series.name, bs.series.id)
        }
      }
    }
    if (libraryItem.book!.bookAuthors?.length) {
      for (const ba of libraryItem.book!.bookAuthors) {
        if (ba.author) {
          Database.addAuthorToFilterData(libraryItemData.libraryId, ba.author.name, ba.author.id)
          if (newAuthorNames.has(ba.author.name)) {
            SocketAuthority.emitter('author_added', ba.author.toOldJSON())
          }
        }
      }
    }
    Database.addNarratorsToFilterData(libraryItemData.libraryId, libraryItem.book!.narrators)
    Database.addGenresToFilterData(libraryItemData.libraryId, libraryItem.book!.genres)
    Database.addTagsToFilterData(libraryItemData.libraryId, libraryItem.book!.tags)
    Database.addPublisherToFilterData(libraryItemData.libraryId, libraryItem.book!.publisher)
    Database.addLanguageToFilterData(libraryItemData.libraryId, libraryItem.book!.language)

    const publishedYear = libraryItem.book!.publishedYear
    // cast(d): the year string is coerced to a number by the division, as in the JS
    const decade = publishedYear ? `${Math.floor((publishedYear as unknown as number) / 10) * 10}` : null
    Database.addPublishedDecadeToFilterData(libraryItemData.libraryId, decade)

    // Load for emitting to client
    // cast(d): the media of the new book library item is the book created above
    libraryItem.media = (await libraryItem.getMedia({
      include: [
        {
          model: Database.authorModel,
          through: {
            attributes: ['id', 'createdAt']
          }
        },
        {
          model: Database.seriesModel,
          through: {
            attributes: ['id', 'sequence', 'createdAt']
          }
        }
      ],
      order: [
        [Database.authorModel, Database.bookAuthorModel, 'createdAt', 'ASC'],
        [Database.seriesModel, 'bookSeries', 'createdAt', 'ASC']
      ]
    })) as Book

    // cast(d): the library item was created as a book above
    await this.saveMetadataFile(libraryItem as LibraryItem.BookLibraryItem, libraryScan)
    if (global.ServerSettings.storeMetadataWithItem && !libraryItem.isFile) {
      libraryItem.changed('libraryFiles', true)
      await libraryItem.save()
    }

    return libraryItem
  }

  /**
   * @param [existingLibraryItemId]
   */
  async getBookMetadataFromScanData(audioFiles: BookAudioFiles, ebookFileScanData: EBookFileScanData | null, libraryItemData: LibraryItemScanData, libraryScan: LibraryScan | ScanLogger, librarySettings: LibrarySettingsObject, existingLibraryItemId: string | null = null): Promise<BookMetadataObject> {
    // First set book metadata from folder/file names
    const bookMetadata: BookMetadataObject = {
      // The folder or file name gives the title
      title: libraryItemData.mediaMetadata.title!, // required
      titleIgnorePrefix: undefined,
      subtitle: undefined,
      publishedYear: undefined,
      publisher: undefined,
      description: undefined,
      isbn: undefined,
      asin: undefined,
      language: undefined,
      narrators: [],
      genres: [],
      tags: [],
      authors: [],
      series: [],
      chapters: [],
      explicit: undefined,
      abridged: undefined,
      coverPath: undefined
    }

    const bookMetadataSourceHandler = new BookScanner.BookMetadataSourceHandler(bookMetadata, audioFiles, ebookFileScanData, libraryItemData, libraryScan, existingLibraryItemId)
    const metadataPrecedence = librarySettings.metadataPrecedence || Database.libraryModel.defaultMetadataPrecedence
    libraryScan.addLog(LogLevel.DEBUG, `"${bookMetadata.title}" Getting metadata with precedence [${metadataPrecedence.join(', ')}]`)
    for (const metadataSource of metadataPrecedence) {
      // cast(d): metadata source name from the library settings; an unknown name reads undefined and is logged below
      if (bookMetadataSourceHandler[metadataSource as MetadataSourceName]) {
        // cast(d): see above (the name was checked)
        await bookMetadataSourceHandler[metadataSource as MetadataSourceName]()
      } else {
        libraryScan.addLog(LogLevel.ERROR, `Invalid metadata source "${metadataSource}"`)
      }
    }

    // Set cover from library file if one is found otherwise check audiofile
    if (libraryItemData.imageLibraryFiles.length) {
      // Scanned library files have a path (set by setDataFromPath)
      const coverMatch = libraryItemData.imageLibraryFiles.find((iFile) => /\/cover\.[^.\/]*$/.test(iFile.metadata.path!))
      bookMetadata.coverPath = coverMatch?.metadata.path || libraryItemData.imageLibraryFiles[0].metadata.path
    }

    bookMetadata.titleIgnorePrefix = getTitleIgnorePrefix(bookMetadata.title)

    if (typeof bookMetadata.description === 'string' && bookMetadata.description) {
      bookMetadata.description = htmlSanitizer.sanitize(bookMetadata.description)
    }

    return bookMetadata
  }

  static BookMetadataSourceHandler = class {
    declare bookMetadata: BookMetadataObject
    declare audioFiles: BookAudioFiles
    declare ebookFileScanData: EBookFileScanData | null
    declare libraryItemData: LibraryItemScanData
    declare libraryScan: LibraryScan | ScanLogger
    declare existingLibraryItemId: string | null

    constructor(bookMetadata: BookMetadataObject, audioFiles: BookAudioFiles, ebookFileScanData: EBookFileScanData | null, libraryItemData: LibraryItemScanData, libraryScan: LibraryScan | ScanLogger, existingLibraryItemId: string | null) {
      this.bookMetadata = bookMetadata
      this.audioFiles = audioFiles
      this.ebookFileScanData = ebookFileScanData
      this.libraryItemData = libraryItemData
      this.libraryScan = libraryScan
      this.existingLibraryItemId = existingLibraryItemId
    }

    /**
     * Metadata parsed from folder names/structure
     */
    folderStructure() {
      this.libraryItemData.setBookMetadataFromFilenames(this.bookMetadata)
    }

    /**
     * Metadata from audio file meta tags OR metadata from ebook file
     */
    audioMetatags() {
      if (this.audioFiles.length) {
        // Modifies bookMetadata with metadata mapped from audio file meta tags
        // The folder or file name gives the title
        const bookTitle = this.bookMetadata.title || this.libraryItemData.mediaMetadata.title!
        AudioFileScanner.setBookMetadataFromAudioMetaTags(bookTitle, this.audioFiles, this.bookMetadata, this.libraryScan)
      } else if (this.ebookFileScanData) {
        const ebookMetdataObject: EbookMetadataFields = this.ebookFileScanData.metadata || {}
        for (const key in ebookMetdataObject) {
          if (key === 'tags') {
            // The key is in the ebook metadata
            if (ebookMetdataObject.tags!.length) {
              this.bookMetadata.tags = ebookMetdataObject.tags!
            }
          } else if (key === 'genres') {
            // The key is in the ebook metadata
            if (ebookMetdataObject.genres!.length) {
              this.bookMetadata.genres = ebookMetdataObject.genres!
            }
          } else if (key === 'authors') {
            if (ebookMetdataObject.authors?.length) {
              this.bookMetadata.authors = ebookMetdataObject.authors
            }
          } else if (key === 'narrators') {
            if (ebookMetdataObject.narrators?.length) {
              this.bookMetadata.narrators = ebookMetdataObject.narrators
            }
          } else if (key === 'series') {
            if (ebookMetdataObject.series?.length) {
              this.bookMetadata.series = ebookMetdataObject.series
            }
            // cast(d): dynamic metadata key
          } else if ((ebookMetdataObject as Record<string, unknown>)[key] && key !== 'sequence') {
            // cast(d): dynamic metadata key (both casts)
            (this.bookMetadata as Record<string, unknown>)[key] = (ebookMetdataObject as Record<string, unknown>)[key]
          }
        }
      }
      return null
    }

    /**
     * Metadata from .nfo file
     */
    async nfoFile() {
      if (!this.libraryItemData.metadataNfoLibraryFile) return
      await NfoFileScanner.scanBookNfoFile(this.libraryItemData.metadataNfoLibraryFile, this.bookMetadata)
    }

    /**
     * Description from desc.txt and narrator from reader.txt
     */
    async txtFiles() {
      // If desc.txt in library item folder then use this for description
      if (this.libraryItemData.descTxtLibraryFile) {
        // Scanned library files have a path (set by setDataFromPath)
        const description = await readTextFile(this.libraryItemData.descTxtLibraryFile.metadata.path!)
        if (description.trim()) this.bookMetadata.description = description.trim()
      }

      // If reader.txt in library item folder then use this for narrator
      if (this.libraryItemData.readerTxtLibraryFile) {
        // Scanned library files have a path (set by setDataFromPath)
        let narrator = await readTextFile(this.libraryItemData.readerTxtLibraryFile.metadata.path!)
        narrator = narrator.split(/\r?\n/)[0]?.trim() || '' // Only use first line
        if (narrator) {
          // cast(d): the name parser types its names as possibly undefined; they are the parsed strings
          this.bookMetadata.narrators = (parseNameString.parse(narrator)?.names || []) as string[]
        }
      }
    }

    /**
     * Metadata from opf file
     */
    async opfFile() {
      if (!this.libraryItemData.metadataOpfLibraryFile) return
      await OpfFileScanner.scanBookOpfFile(this.libraryItemData.metadataOpfLibraryFile, this.bookMetadata)
    }

    /**
     * Metadata from metadata.json
     */
    async absMetadata() {
      // If metadata.json use this for metadata
      await AbsMetadataFileScanner.scanBookMetadataFile(this.libraryScan, this.libraryItemData, this.bookMetadata, this.existingLibraryItemId)
    }
  }

  async saveMetadataFile(libraryItem: LibraryItem.BookLibraryItem, libraryScan: LibraryScan | ScanLogger) {
    let metadataPath = Path.join(global.MetadataPath, 'items', libraryItem.id)
    let storeMetadataWithItem = global.ServerSettings.storeMetadataWithItem
    if (storeMetadataWithItem && !libraryItem.isFile) {
      metadataPath = libraryItem.path
    } else {
      // Make sure metadata book dir exists
      storeMetadataWithItem = false
      await fsExtra.ensureDir(metadataPath)
    }

    const metadataFilePath = Path.join(metadataPath, `metadata.${global.ServerSettings.metadataFileFormat}`)

    /**
     * Keys must match abmetadataGenerator.js
     */
    const jsonObject = {
      tags: libraryItem.media.tags || [],
      chapters: libraryItem.media.chapters?.map((c) => ({ ...c })) || [],
      title: libraryItem.media.title,
      subtitle: libraryItem.media.subtitle,
      authors: libraryItem.media.authors.map((a) => a.name),
      narrators: libraryItem.media.narrators,
      series: libraryItem.media.series.map((se) => {
        const sequence = se.bookSeries?.sequence || ''
        if (!sequence) return se.name
        return `${se.name} #${sequence}`
      }),
      genres: libraryItem.media.genres || [],
      publishedYear: libraryItem.media.publishedYear,
      publishedDate: libraryItem.media.publishedDate,
      publisher: libraryItem.media.publisher,
      description: libraryItem.media.description,
      isbn: libraryItem.media.isbn,
      asin: libraryItem.media.asin,
      language: libraryItem.media.language,
      explicit: !!libraryItem.media.explicit,
      abridged: !!libraryItem.media.abridged
    }
    return fsExtra
      .writeFile(metadataFilePath, JSON.stringify(jsonObject, null, 2))
      .then(async () => {
        // Add metadata.json to libraryFiles array if it is new
        let metadataLibraryFile = libraryItem.libraryFiles.find((lf) => lf.metadata.path === filePathToPOSIX(metadataFilePath))
        if (storeMetadataWithItem) {
          if (!metadataLibraryFile) {
            const newLibraryFile = new LibraryFile()
            await newLibraryFile.setDataFromPath(metadataFilePath, `metadata.json`)
            metadataLibraryFile = newLibraryFile.toJSON()
            libraryItem.libraryFiles.push(metadataLibraryFile)
          } else {
            const fileTimestamps = await getFileTimestampsWithIno(metadataFilePath)
            if (fileTimestamps) {
              metadataLibraryFile.metadata.mtimeMs = fileTimestamps.mtimeMs
              metadataLibraryFile.metadata.ctimeMs = fileTimestamps.ctimeMs
              metadataLibraryFile.metadata.size = fileTimestamps.size
              metadataLibraryFile.ino = fileTimestamps.ino
            }
          }
          const libraryItemDirTimestamps = await getFileTimestampsWithIno(libraryItem.path)
          if (libraryItemDirTimestamps) {
            libraryItem.mtime = libraryItemDirTimestamps.mtimeMs
            libraryItem.ctime = libraryItemDirTimestamps.ctimeMs
            let size = 0
            libraryItem.libraryFiles.forEach((lf) => (size += !isNaN(lf.metadata.size) ? Number(lf.metadata.size) : 0))
            libraryItem.size = size
          }
        }

        libraryScan.addLog(LogLevel.DEBUG, `Success saving abmetadata to "${metadataFilePath}"`)

        return metadataLibraryFile
      })
      .catch((error: Error) => {
        libraryScan.addLog(LogLevel.ERROR, `Failed to save json file at "${metadataFilePath}"`, error)
        return null
      })
  }

  /**
   * Emit authors_num_books_updated for authors whose book count changed during a scan (linked or unlinked).
   * Authors with no book links are omitted — orphans are handled by author_removed.
   */
  async emitAuthorsNumBooksUpdated(libraryId: string, scanLogger: LibraryScan | ScanLogger) {
    if (!scanLogger.authorsNumBooksChangedIds?.size) return

    const authorIds = [...scanLogger.authorsNumBooksChangedIds]
    scanLogger.authorsNumBooksChangedIds.clear()

    const countsByAuthorId = await Database.bookAuthorModel.getCountsForAuthors(authorIds)

    const authors = Object.entries(countsByAuthorId).map(([id, numBooks]) => ({
      id,
      numBooks
    }))

    if (!authors.length) return

    SocketAuthority.emitter('authors_num_books_updated', {
      libraryId,
      authors
    })
  }

  /**
   * Check authors that were removed from a book and remove them if they no longer have any books
   * keep authors without books that have a asin, description or imagePath
   */
  async checkAuthorsRemovedFromBooks(libraryId: string, scanLogger: LibraryScan | ScanLogger) {
    const bookAuthorsToRemove = (
      await Database.authorModel.findAll({
        where: [
          {
            id: scanLogger.authorsRemovedFromBooks,
            asin: {
              [sequelize.Op.or]: [null, '']
            },
            description: {
              [sequelize.Op.or]: [null, '']
            },
            imagePath: {
              [sequelize.Op.or]: [null, '']
            }
          },
          sequelize.where(sequelize.literal('(SELECT count(*) FROM bookAuthors ba WHERE ba.authorId = author.id)'), 0)
        ],
        attributes: ['id'],
        raw: true
      })
    ).map((au) => au.id)
    if (bookAuthorsToRemove.length) {
      await Database.authorModel.destroy({
        where: {
          id: bookAuthorsToRemove
        }
      })
      bookAuthorsToRemove.forEach((authorId) => {
        Database.removeAuthorFromFilterData(libraryId, authorId)
        // TODO: Clients were expecting full author in payload but its unnecessary
        SocketAuthority.emitter('author_removed', { id: authorId, libraryId })
      })
      scanLogger.addLog(LogLevel.INFO, `Removed ${bookAuthorsToRemove.length} authors`)
    }
  }

  /**
   * Check series that were removed from books and remove them if they no longer have any books
   */
  async checkSeriesRemovedFromBooks(libraryId: string, scanLogger: LibraryScan | ScanLogger) {
    const bookSeriesToRemove = (
      await Database.seriesModel.findAll({
        where: [
          {
            id: scanLogger.seriesRemovedFromBooks
          },
          sequelize.where(sequelize.literal('(SELECT count(*) FROM bookSeries bs WHERE bs.seriesId = series.id)'), 0)
        ],
        attributes: ['id'],
        raw: true
      })
    ).map((se) => se.id)
    if (bookSeriesToRemove.length) {
      await Database.seriesModel.destroy({
        where: {
          id: bookSeriesToRemove
        }
      })
      // Close any open feeds for series
      await RssFeedManager.closeFeedsForEntityIds(bookSeriesToRemove)

      bookSeriesToRemove.forEach((seriesId) => {
        Database.removeSeriesFromFilterData(libraryId, seriesId)
        SocketAuthority.emitter('series_removed', { id: seriesId, libraryId })
      })
      scanLogger.addLog(LogLevel.INFO, `Removed ${bookSeriesToRemove.length} series`)
    }
  }

  /**
   * Search cover provider for matching cover
   * @param libraryItemPath null if book isFile
   * @returns path to downloaded cover or null if no cover found
   */
  async searchForCover(libraryItemId: string, libraryItemPath: string | null, title: string, author: string, libraryScan: LibraryScan | ScanLogger): Promise<string | null> {
    const options = {
      titleDistance: 2,
      authorDistance: 2
    }
    const results = await BookFinder.findCovers(Database.serverSettings.scannerCoverProvider, title, author, options)
    if (results.length) {
      libraryScan.addLog(LogLevel.DEBUG, `Found best cover for "${title}"`)

      // If the first cover result fails, attempt to download the second
      for (let i = 0; i < results.length && i < 2; i++) {
        // Downloads and updates the book cover
        const result = await CoverManager.downloadCoverFromUrlNew(results[i], libraryItemId, libraryItemPath)

        if (result.error) {
          libraryScan.addLog(LogLevel.ERROR, `Failed to download cover from url "${results[i]}" | Attempt ${i + 1}`, result.error)
        } else if (result.cover) {
          return result.cover
        }
      }
    }
    return null
  }
}
export = new BookScanner()
