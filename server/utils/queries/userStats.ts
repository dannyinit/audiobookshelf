import Sequelize = require('sequelize')
import DatabaseModule = require('../../Database')
import PlaybackSession = require('../../models/PlaybackSession')
import MediaProgress = require('../../models/MediaProgress')
import fsExtraModule = require('../../libs/fsExtra')
import Book = require('../../models/Book')
import LibraryItem = require('../../models/LibraryItem')
import type { Includeable } from 'sequelize'
import type { FsExtra, PlaybackMediaMetadata } from '../types'

// Same module object (kept as an alias so the compiled module is unchanged)
const Database = DatabaseModule
// The inferred type of the vendored fs-extra lacks the fs methods it adds at runtime
const fsExtra = fsExtraModule as unknown as FsExtra

/**
 * Book loaded through the session/progress include, with its libraryItem
 */
type IncludedBook = Book & { libraryItem: LibraryItem }

export = {
  /**
   *
   * @param year YYYY
   */
  async getUserListeningSessionsForYear(userId: string, year: number): Promise<(PlaybackSession & { mediaItem?: IncludedBook | null })[]> {
    const sessions = await Database.playbackSessionModel.findAll({
      where: {
        userId,
        createdAt: {
          [Sequelize.Op.gte]: `${year}-01-01`,
          [Sequelize.Op.lt]: `${year + 1}-01-01`
        }
      },
      include: {
        model: Database.bookModel,
        attributes: ['id', 'coverPath'],
        // sequelize accepts a single nested include object; its types only allow an array
        include: {
          model: Database.libraryItemModel,
          attributes: ['id', 'mediaId', 'mediaType']
        } as unknown as Includeable[],
        required: false
      },
      order: Database.sequelize.random()
    })
    // The book (mediaItem) is included above
    return sessions as (PlaybackSession & { mediaItem?: IncludedBook | null })[]
  },

  /**
   *
   * @param year YYYY
   */
  async getBookMediaProgressFinishedForYear(userId: string, year: number): Promise<(MediaProgress & { mediaItem: IncludedBook })[]> {
    const progresses = await Database.mediaProgressModel.findAll({
      where: {
        userId,
        mediaItemType: 'book',
        finishedAt: {
          [Sequelize.Op.gte]: `${year}-01-01`,
          [Sequelize.Op.lt]: `${year + 1}-01-01`
        }
      },
      include: {
        model: Database.bookModel,
        attributes: ['id', 'title', 'coverPath'],
        // sequelize accepts a single nested include object; its types only allow an array
        include: {
          model: Database.libraryItemModel,
          attributes: ['id', 'mediaId', 'mediaType']
        } as unknown as Includeable[],
        required: true
      },
      order: Database.sequelize.random()
    })
    // The book (mediaItem) is included above
    return progresses as (MediaProgress & { mediaItem: IncludedBook })[]
  },

  /**
   * @param year YYYY
   */
  async getStatsForYear(userId: string, year: number) {
    const listeningSessions = await this.getUserListeningSessionsForYear(userId, year)
    const bookProgressesFinished = await this.getBookMediaProgressFinishedForYear(userId, year)

    let totalBookListeningTime = 0
    let totalPodcastListeningTime = 0
    let totalListeningTime = 0

    let authorListeningMap: Record<string, number> = {}
    let genreListeningMap: Record<string, number> = {}
    let narratorListeningMap: Record<string, number> = {}
    let monthListeningMap: Record<string, number> = {}
    let bookListeningMap: Record<string, number> = {}

    const booksWithCovers: string[] = []
    const finishedBooksWithCovers: string[] = []

    // Get finished book stats
    const numBooksFinished = bookProgressesFinished.length
    let longestAudiobookFinished = null
    for (const mediaProgress of bookProgressesFinished) {
      // Grab first 5 that have a cover
      if (mediaProgress.mediaItem?.coverPath && !finishedBooksWithCovers.includes(mediaProgress.mediaItem.libraryItem.id) && finishedBooksWithCovers.length < 5 && (await fsExtra.pathExists(mediaProgress.mediaItem.coverPath))) {
        finishedBooksWithCovers.push(mediaProgress.mediaItem.libraryItem.id)
      }

      if (mediaProgress.duration && (!longestAudiobookFinished?.duration || mediaProgress.duration > longestAudiobookFinished.duration)) {
        longestAudiobookFinished = {
          id: mediaProgress.mediaItem.id,
          title: mediaProgress.mediaItem.title,
          duration: Math.round(mediaProgress.duration),
          finishedAt: mediaProgress.finishedAt
        }
      }
    }

    // Get listening session stats
    for (const ls of listeningSessions) {
      // Grab first 25 that have a cover
      if (ls.mediaItem?.coverPath && !booksWithCovers.includes(ls.mediaItem.libraryItem.id) && !finishedBooksWithCovers.includes(ls.mediaItem.libraryItem.id) && booksWithCovers.length < 25 && (await fsExtra.pathExists(ls.mediaItem.coverPath))) {
        booksWithCovers.push(ls.mediaItem.libraryItem.id)
      }

      const listeningSessionListeningTime = ls.timeListening || 0

      const lsMonth = ls.createdAt.getMonth()
      if (!monthListeningMap[lsMonth]) monthListeningMap[lsMonth] = 0
      monthListeningMap[lsMonth] += listeningSessionListeningTime

      totalListeningTime += listeningSessionListeningTime
      if (ls.mediaItemType === 'book') {
        totalBookListeningTime += listeningSessionListeningTime

        if (ls.displayTitle && !bookListeningMap[ls.displayTitle]) {
          bookListeningMap[ls.displayTitle] = listeningSessionListeningTime
        } else if (ls.displayTitle) {
          bookListeningMap[ls.displayTitle] += listeningSessionListeningTime
        }

        // mediaMetadata is a JSON column
        const mediaMetadata = ls.mediaMetadata as PlaybackMediaMetadata | null
        const authors = mediaMetadata?.authors || []
        authors.forEach((au) => {
          if (!authorListeningMap[au.name]) authorListeningMap[au.name] = 0
          authorListeningMap[au.name] += listeningSessionListeningTime
        })

        const narrators = mediaMetadata?.narrators || []
        narrators.forEach((narrator) => {
          if (!narratorListeningMap[narrator]) narratorListeningMap[narrator] = 0
          narratorListeningMap[narrator] += listeningSessionListeningTime
        })

        // Filter out bad genres like "audiobook" and "audio book"
        const genres = (mediaMetadata?.genres || []).filter((g) => g && !g.toLowerCase().includes('audiobook') && !g.toLowerCase().includes('audio book'))
        genres.forEach((genre) => {
          if (!genreListeningMap[genre]) genreListeningMap[genre] = 0
          genreListeningMap[genre] += listeningSessionListeningTime
        })
      } else {
        totalPodcastListeningTime += listeningSessionListeningTime
      }
    }

    totalListeningTime = Math.round(totalListeningTime)
    totalBookListeningTime = Math.round(totalBookListeningTime)
    totalPodcastListeningTime = Math.round(totalPodcastListeningTime)

    let topAuthors = null
    topAuthors = Object.keys(authorListeningMap)
      .map((authorName) => ({
        name: authorName,
        time: Math.round(authorListeningMap[authorName])
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 3)

    let mostListenedNarrator = null
    for (const narrator in narratorListeningMap) {
      if (!mostListenedNarrator?.time || narratorListeningMap[narrator] > mostListenedNarrator.time) {
        mostListenedNarrator = {
          time: Math.round(narratorListeningMap[narrator]),
          name: narrator
        }
      }
    }

    let topGenres = null
    topGenres = Object.keys(genreListeningMap)
      .map((genre) => ({
        genre,
        time: Math.round(genreListeningMap[genre])
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 3)

    let mostListenedMonth = null
    for (const month in monthListeningMap) {
      if (!mostListenedMonth?.time || monthListeningMap[month] > mostListenedMonth.time) {
        mostListenedMonth = {
          month: Number(month),
          time: Math.round(monthListeningMap[month])
        }
      }
    }

    return {
      totalListeningSessions: listeningSessions.length,
      totalListeningTime,
      totalBookListeningTime,
      totalPodcastListeningTime,
      topAuthors,
      topGenres,
      mostListenedNarrator,
      mostListenedMonth,
      numBooksFinished,
      numBooksListened: Object.keys(bookListeningMap).length,
      longestAudiobookFinished,
      booksWithCovers,
      finishedBooksWithCovers
    }
  }
}
