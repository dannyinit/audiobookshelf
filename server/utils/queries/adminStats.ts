import Sequelize = require('sequelize')
import DatabaseModule = require('../../Database')
import PlaybackSession = require('../../models/PlaybackSession')
import fsExtraModule = require('../../libs/fsExtra')
import Book = require('../../models/Book')
import LibraryItem = require('../../models/LibraryItem')
import type { PlaybackMediaMetadata } from '../types'

// Same module object (kept as an alias so the compiled module is unchanged)
const Database = DatabaseModule
const fsExtra = fsExtraModule

/**
 * Book with its libraryItem. size is a BIGINT column that sqlite returns as a number (the model JSDoc says BigInt)
 */
type BookWithLibraryItem = Book & { libraryItem: Omit<LibraryItem, 'size'> & { size: number } }

export = {
  /**
   *
   * @param year YYYY
   */
  async getListeningSessionsForYear(year: number): Promise<PlaybackSession[]> {
    const sessions = await Database.playbackSessionModel.findAll({
      where: {
        createdAt: {
          [Sequelize.Op.gte]: `${year}-01-01`,
          [Sequelize.Op.lt]: `${year + 1}-01-01`
        }
      }
    })
    return sessions
  },

  /**
   *
   * @param year YYYY
   */
  async getNumAuthorsAddedForYear(year: number): Promise<number> {
    const count = await Database.authorModel.count({
      where: {
        createdAt: {
          [Sequelize.Op.gte]: `${year}-01-01`,
          [Sequelize.Op.lt]: `${year + 1}-01-01`
        }
      }
    })
    return count
  },

  /**
   *
   * @param year YYYY
   */
  async getBooksAddedForYear(year: number) {
    const books = await Database.bookModel.findAll({
      attributes: ['id', 'title', 'coverPath', 'duration', 'createdAt'],
      where: {
        createdAt: {
          [Sequelize.Op.gte]: `${year}-01-01`,
          [Sequelize.Op.lt]: `${year + 1}-01-01`
        }
      },
      include: {
        model: Database.libraryItemModel,
        attributes: ['id', 'mediaId', 'mediaType', 'size'],
        required: true
      },
      order: Database.sequelize.random()
    })
    // cast(b): Sequelize types findAll rows without their includes; libraryItem is included above
    return books as unknown as BookWithLibraryItem[]
  },

  /**
   *
   * @param year YYYY
   */
  async getStatsForYear(year: number) {
    const booksAdded = await this.getBooksAddedForYear(year)

    let totalBooksAddedSize = 0
    let totalBooksAddedDuration = 0
    const booksWithCovers: string[] = []

    for (const book of booksAdded) {
      // Grab first 25 that have a cover
      if (book.coverPath && !booksWithCovers.includes(book.libraryItem.id) && booksWithCovers.length < 25 && (await fsExtra.pathExists(book.coverPath))) {
        booksWithCovers.push(book.libraryItem.id)
      }
      if (book.duration && !isNaN(book.duration)) {
        totalBooksAddedDuration += book.duration
      }
      if (book.libraryItem.size && !isNaN(book.libraryItem.size)) {
        totalBooksAddedSize += book.libraryItem.size
      }
    }

    const numAuthorsAdded = await this.getNumAuthorsAddedForYear(year)

    let authorListeningMap: Record<string, number> = {}
    let narratorListeningMap: Record<string, number> = {}
    let genreListeningMap: Record<string, number> = {}

    const listeningSessions = await this.getListeningSessionsForYear(year)
    let totalListeningTime = 0
    for (const ls of listeningSessions) {
      totalListeningTime += ls.timeListening || 0

      // cast(d): mediaMetadata is the PlaybackSession JSON column, typed PlaybackMediaMetadata | null since batch 3a; the cast changes no type
      const mediaMetadata = ls.mediaMetadata as PlaybackMediaMetadata | null
      const authors = mediaMetadata?.authors || []
      authors.forEach((au) => {
        if (!authorListeningMap[au.name]) authorListeningMap[au.name] = 0
        authorListeningMap[au.name] += ls.timeListening || 0
      })

      const narrators = mediaMetadata?.narrators || []
      narrators.forEach((narrator) => {
        if (!narratorListeningMap[narrator]) narratorListeningMap[narrator] = 0
        narratorListeningMap[narrator] += ls.timeListening || 0
      })

      // Filter out bad genres like "audiobook" and "audio book"
      const genres = (mediaMetadata?.genres || []).filter((g) => g && !g.toLowerCase().includes('audiobook') && !g.toLowerCase().includes('audio book'))
      genres.forEach((genre) => {
        if (!genreListeningMap[genre]) genreListeningMap[genre] = 0
        genreListeningMap[genre] += ls.timeListening || 0
      })
    }

    let topAuthors = null
    topAuthors = Object.keys(authorListeningMap)
      .map((authorName) => ({
        name: authorName,
        time: Math.round(authorListeningMap[authorName])
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 3)

    let topNarrators = null
    topNarrators = Object.keys(narratorListeningMap)
      .map((narratorName) => ({
        name: narratorName,
        time: Math.round(narratorListeningMap[narratorName])
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 3)

    let topGenres = null
    topGenres = Object.keys(genreListeningMap)
      .map((genre) => ({
        genre,
        time: Math.round(genreListeningMap[genre])
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 3)

    // Stats for total books, size and duration for everything added this year or earlier
    const [totalStatResultsRow] = await Database.sequelize.query(`SELECT SUM(li.size) AS totalSize, SUM(b.duration) AS totalDuration, COUNT(*) AS totalItems FROM libraryItems li, books b WHERE b.id = li.mediaId AND li.mediaType = 'book' AND li.createdAt < ":nextYear-01-01";`, {
      replacements: {
        nextYear: year + 1
      }
    })
    // cast(b): query() types the rows as unknown[]; the first row has the selected sums and the count (undefined when there is no row)
    const totalStatResults = totalStatResultsRow[0] as { totalSize: number | null; totalDuration: number | null; totalItems: number } | undefined

    return {
      numListeningSessions: listeningSessions.length,
      numBooksAdded: booksAdded.length,
      numAuthorsAdded,
      totalBooksAddedSize,
      totalBooksAddedDuration: Math.round(totalBooksAddedDuration),
      booksAddedWithCovers: booksWithCovers,
      totalBooksSize: totalStatResults?.totalSize || 0,
      totalBooksDuration: totalStatResults?.totalDuration || 0,
      totalListeningTime,
      numBooks: totalStatResults?.totalItems || 0,
      topAuthors,
      topNarrators,
      topGenres
    }
  },

  /**
   * Get total file size and number of items for books and podcasts
   */
  async getTotalSize() {
    const [mediaTypeStatsRows] = await Database.sequelize.query(`SELECT li.mediaType, SUM(li.size) AS totalSize, COUNT(*) AS numItems FROM libraryItems li group by li.mediaType;`)
    // cast(b): query() types the rows as unknown[]; the rows have the selected columns (mediaType, totalSize, numItems)
    const mediaTypeStats = mediaTypeStatsRows as { mediaType: string; totalSize: number | null; numItems: number }[]
    const bookStats = mediaTypeStats.find((m) => m.mediaType === 'book')
    const podcastStats = mediaTypeStats.find((m) => m.mediaType === 'podcast')

    return {
      books: {
        totalSize: bookStats?.totalSize || 0,
        numItems: bookStats?.numItems || 0
      },
      podcasts: {
        totalSize: podcastStats?.totalSize || 0,
        numItems: podcastStats?.numItems || 0
      },
      total: {
        totalSize: (bookStats?.totalSize || 0) + (podcastStats?.totalSize || 0),
        numItems: (bookStats?.numItems || 0) + (podcastStats?.numItems || 0)
      }
    }
  },

  /**
   * Get total number of audio files for books and podcasts
   *
   * @returns {Promise<{numBookAudioFiles: number, numPodcastAudioFiles: number, numAudioFiles: number}>}
   */
  async getNumAudioFiles() {
    const [numBookAudioFilesRow] = await Database.sequelize.query(`SELECT SUM(json_array_length(b.audioFiles)) AS numAudioFiles FROM books b;`)
    // cast(b): query() types the rows as unknown[]; the first row has the selected sum (undefined when there is no row)
    const numBookAudioFiles = (numBookAudioFilesRow[0] as { numAudioFiles: number | null } | undefined)?.numAudioFiles || 0
    const numPodcastAudioFiles = await Database.podcastEpisodeModel.count()
    return {
      numBookAudioFiles,
      numPodcastAudioFiles,
      numAudioFiles: numBookAudioFiles + numPodcastAudioFiles
    }
  }
}
