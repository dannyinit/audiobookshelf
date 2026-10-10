import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import Database = require('../Database')
import utils = require('../utils/index')

// Utils
import podcastUtils = require('../utils/podcastUtils')

import BookFinder = require('../finders/BookFinder')
import PodcastFinder = require('../finders/PodcastFinder')
import LibraryScan = require('./LibraryScan')
import LibraryScanner = require('./LibraryScanner')
import CoverManager = require('../managers/CoverManager')
import TaskManager = require('../managers/TaskManager')
import type ApiRouter = require('../routers/ApiRouter')
import type LibraryItem = require('../models/LibraryItem')
import type Library = require('../models/Library')
import type Book = require('../models/Book')
import type Podcast = require('../models/Podcast')
import type PodcastEpisode = require('../models/PodcastEpisode')
import type iTunes = require('../providers/iTunes')
import type { BookSearchResult, SeriesResult } from '../providers/types'
import type { Model } from 'sequelize'
import type { RssPodcastEpisode } from '../models/types'
import dynamicKey = require('./dynamicKey')
const { getKey } = dynamicKey
const { getTitleIgnorePrefix } = utils
const { findMatchingEpisodesInFeed, getPodcastFeed } = podcastUtils

interface QuickMatchOptions {
  provider?: string
  title?: string
  author?: string
  /** This override is currently unused in Abs clients */
  isbn?: string
  /** This override is currently unused in Abs clients */
  asin?: string
  overrideCover?: boolean
  overrideDetails?: boolean
}

/**
 * Book search result as the quick match reads it: author may be a comma separated string or a list,
 * series a list or a single series name with its sequence (they are replaced with lists below)
 */
type BookMatchData = Omit<BookSearchResult, 'author' | 'series'> & {
  author?: string | string[] | null
  series?: SeriesResult[] | string | null
  sequence?: string
}

class Scanner {
  constructor() {}

  async quickMatchLibraryItem(apiRouterCtx: ApiRouter, libraryItem: LibraryItem.LibraryItemExpanded, options: QuickMatchOptions = {}) {
    const provider = options.provider || 'google'
    const searchTitle = options.title || libraryItem.media.title
    // cast(d): podcasts have no authorName (undefined); it is only used for books
    const searchAuthor = options.author || (libraryItem.media as Book).authorName

    // If overrideCover and overrideDetails is not sent in options than use the server setting to determine if we should override
    if (options.overrideCover === undefined && options.overrideDetails === undefined && Database.serverSettings.scannerPreferMatchedMetadata) {
      options.overrideCover = true
      options.overrideDetails = true
    }

    let updatePayload: Record<string, unknown> = {}
    let hasUpdated = false

    if (libraryItem.isBook) {
      // cast(d): isBook was checked just above
      const searchISBN = options.isbn || (libraryItem.media as Book).isbn
      // cast(d): isBook was checked above
      const searchASIN = options.asin || (libraryItem.media as Book).asin

      // cast(d): a book without a title (null) is passed on; search returns no results for it (except custom providers), as in the JS
      const results = await BookFinder.search(libraryItem, provider, searchTitle as string, searchAuthor, searchISBN, searchASIN, { maxFuzzySearches: 2 })
      if (!results.length) {
        return {
          warning: `No ${provider} match found`
        }
      }
      const matchData = results[0]

      // Update cover if not set OR overrideCover flag
      if (matchData.cover && (!libraryItem.media.coverPath || options.overrideCover)) {
        Logger.debug(`[Scanner] Updating cover "${matchData.cover}"`)
        const coverResult = await CoverManager.downloadCoverFromUrlNew(matchData.cover, libraryItem.id, libraryItem.isFile ? null : libraryItem.path)
        if (coverResult.error) {
          Logger.warn(`[Scanner] Match cover "${matchData.cover}" failed to use: ${coverResult.error}`)
        } else {
          // The error was checked just above, so the cover path is set
          libraryItem.media.coverPath = coverResult.cover!
          // cast(d): isBook was checked above
          ;(libraryItem.media as Book).changed('coverPath', true) // Cover path may be the same but this forces the update
          hasUpdated = true
        }
      }

      // cast(d): isBook was checked above
      const bookBuildUpdateData = await this.quickMatchBookBuildUpdatePayload(apiRouterCtx, libraryItem as LibraryItem.BookLibraryItem, matchData, options)
      updatePayload = bookBuildUpdateData.updatePayload
      if (bookBuildUpdateData.hasSeriesUpdates || bookBuildUpdateData.hasAuthorUpdates) {
        hasUpdated = true
      }
    } else if (libraryItem.isPodcast) {
      // Podcast quick match
      const results = await PodcastFinder.search(searchTitle)
      // NOTE: search returns null for a podcast without a title; results.length then throws a TypeError
      if (!results!.length) {
        return {
          warning: `No ${provider} match found`
        }
      }
      // See NOTE above
      const matchData = results![0]

      // Update cover if not set OR overrideCover flag
      if (matchData.cover && (!libraryItem.media.coverPath || options.overrideCover)) {
        Logger.debug(`[Scanner] Updating cover "${matchData.cover}"`)
        const coverResult = await CoverManager.downloadCoverFromUrlNew(matchData.cover, libraryItem.id, libraryItem.path)
        if (coverResult.error) {
          Logger.warn(`[Scanner] Match cover "${matchData.cover}" failed to use: ${coverResult.error}`)
        } else {
          // The error was checked just above, so the cover path is set
          libraryItem.media.coverPath = coverResult.cover!
          // cast(d): isPodcast was checked above
          ;(libraryItem.media as Podcast).changed('coverPath', true) // Cover path may be the same but this forces the update
          hasUpdated = true
        }
      }

      // cast(d): isPodcast was checked above
      updatePayload = this.quickMatchPodcastBuildUpdatePayload(libraryItem as LibraryItem.PodcastLibraryItem, matchData, options)
    }

    if (Object.keys(updatePayload).length) {
      Logger.debug('[Scanner] Updating details with payload', updatePayload)
      // cast(b): sequelize's typed model methods are not callable on the Book | Podcast union; both are models
      ;(libraryItem.media as Model).set(updatePayload)
      // cast(b): sequelize's typed model methods are not callable on the Book | Podcast union; both are models
      if ((libraryItem.media as Model).changed()) {
        // cast(b): sequelize's typed model methods are not callable on the Book | Podcast union; both are models
        Logger.debug(`[Scanner] Updating library item "${libraryItem.media.title}" keys`, (libraryItem.media as Model).changed())
        hasUpdated = true
      }
    }

    if (hasUpdated) {
      // cast(d): isPodcast is checked first
      if (libraryItem.isPodcast && (libraryItem.media as Podcast).feedURL) {
        // Quick match all unmatched podcast episodes
        // cast(d): isPodcast was checked above
        await this.quickMatchPodcastEpisodes(libraryItem as LibraryItem.PodcastLibraryItem, options)
      }

      // cast(b): sequelize's typed model methods are not callable on the Book | Podcast union; both are models
      await (libraryItem.media as Model).save()

      libraryItem.changed('updatedAt', true)
      await libraryItem.save()

      await libraryItem.saveMetadataFile()

      SocketAuthority.libraryItemEmitter('item_updated', libraryItem)
    }

    return {
      updated: hasUpdated,
      libraryItem: libraryItem.toOldJSONExpanded()
    }
  }

  /**
   * @returns Update payload
   */
  quickMatchPodcastBuildUpdatePayload(libraryItem: LibraryItem.PodcastLibraryItem, matchData: iTunes.iTunesPodcastSearchResult, options: QuickMatchOptions): Record<string, unknown> {
    const updatePayload: Record<string, unknown> = {}

    const matchDataTransformed = {
      title: matchData.title || null,
      author: matchData.artistName || null,
      genres: matchData.genres || [],
      itunesId: matchData.id || null,
      itunesPageUrl: matchData.pageUrl || null,
      itunesArtistId: matchData.artistId || null,
      releaseDate: matchData.releaseDate || null,
      imageUrl: matchData.cover || null,
      feedUrl: matchData.feedUrl || null,
      description: matchData.descriptionPlain || null
    }

    for (const key in matchDataTransformed) {
      if (getKey(matchDataTransformed, key)) {
        if (key === 'genres') {
          if (!libraryItem.media.genres.length || options.overrideDetails) {
            var genresArray: string[] = []
            // cast(d): dynamic metadata key (the genres list, checked with Array.isArray just before)
            if (Array.isArray(getKey(matchDataTransformed, key))) genresArray = [...(matchDataTransformed as unknown as Record<string, string[]>)[key]]
            else {
              // Genres should always be passed in as an array but just incase handle a string
              Logger.warn(`[Scanner] quickMatch genres is not an array ${getKey(matchDataTransformed, key)}`)
              // cast(d): dynamic metadata key (a genres string)
              genresArray = (matchDataTransformed as unknown as Record<string, string>)[key]
                .split(',')
                .map((v) => v.trim())
                .filter((v) => !!v)
            }
            updatePayload[key] = genresArray
          }
        } else if (getKey(libraryItem.media, key) !== getKey(matchDataTransformed, key) && (!getKey(libraryItem.media, key) || options.overrideDetails)) {
          updatePayload[key] = getKey(matchDataTransformed, key)
        }
      }
    }

    return updatePayload
  }

  async quickMatchBookBuildUpdatePayload(apiRouterCtx: ApiRouter, libraryItem: LibraryItem.BookLibraryItem, matchData: BookMatchData, options: QuickMatchOptions): Promise<{ updatePayload: Record<string, unknown>; hasSeriesUpdates: boolean; hasAuthorUpdates: boolean }> {
    // Update media metadata if not set OR overrideDetails flag
    const detailKeysToUpdate = ['title', 'subtitle', 'description', 'narrator', 'publisher', 'publishedYear', 'genres', 'tags', 'language', 'explicit', 'abridged', 'asin', 'isbn']
    const updatePayload: Record<string, unknown> = {}

    for (const key in matchData) {
      if (getKey(matchData, key) && detailKeysToUpdate.includes(key)) {
        if (key === 'narrator') {
          if (!libraryItem.media.narrators?.length || options.overrideDetails) {
            // cast(d): dynamic metadata key (the narrator string)
            updatePayload.narrators = (matchData as Record<string, string>)[key]
              .split(',')
              .map((v) => v.trim())
              .filter((v) => !!v)
          }
        } else if (key === 'genres') {
          if (!libraryItem.media.genres.length || options.overrideDetails) {
            let genresArray: string[] = []
            // cast(d): dynamic metadata key (the genres list, checked with Array.isArray just before)
            if (Array.isArray(getKey(matchData, key))) genresArray = [...(matchData as Record<string, string[]>)[key]]
            else {
              // Genres should always be passed in as an array but just incase handle a string
              Logger.warn(`[Scanner] quickMatch genres is not an array ${getKey(matchData, key)}`)
              // cast(d): dynamic metadata key (a genres string)
              genresArray = (matchData as Record<string, string>)[key]
                .split(',')
                .map((v) => v.trim())
                .filter((v) => !!v)
            }
            updatePayload[key] = genresArray
          }
        } else if (key === 'tags') {
          if (!libraryItem.media.tags.length || options.overrideDetails) {
            let tagsArray: string[] = []
            // cast(d): dynamic metadata key (the tags list, checked with Array.isArray just before)
            if (Array.isArray(getKey(matchData, key))) tagsArray = [...(matchData as Record<string, string[]>)[key]]
            else
              // cast(d): dynamic metadata key (a tags string)
              tagsArray = (matchData as Record<string, string>)[key]
                .split(',')
                .map((v) => v.trim())
                .filter((v) => !!v)
            updatePayload[key] = tagsArray
          }
        } else if (!getKey(libraryItem.media, key) || options.overrideDetails) {
          updatePayload[key] = getKey(matchData, key)
        }
      }
    }

    // Add or set author if not set
    let hasAuthorUpdates = false
    if (matchData.author && (!libraryItem.media.authorName || options.overrideDetails)) {
      if (!Array.isArray(matchData.author)) {
        matchData.author = matchData.author
          .split(',')
          .map((au) => au.trim())
          .filter((au) => !!au)
      }
      const authorIdsRemoved: string[] = []
      for (const authorName of matchData.author) {
        const existingAuthor = libraryItem.media.authors.find((a) => a.name.toLowerCase() === authorName.toLowerCase())
        if (!existingAuthor) {
          let author = await Database.authorModel.getByNameAndLibrary(authorName, libraryItem.libraryId)
          if (!author) {
            author = await Database.authorModel.create({
              name: authorName,
              lastFirst: Database.authorModel.getLastFirst(authorName),
              libraryId: libraryItem.libraryId
            })
            SocketAuthority.emitter('author_added', author.toOldJSON())
            // Update filter data
            Database.addAuthorToFilterData(libraryItem.libraryId, author.name, author.id)
          }
          await Database.bookAuthorModel
            .create({
              authorId: author.id,
              bookId: libraryItem.media.id
            })
            .then(() => {
              Logger.info(`[Scanner] quickMatchBookBuildUpdatePayload: Added author "${author.name}" to "${libraryItem.media.title}"`)
              libraryItem.media.authors.push(author)
              hasAuthorUpdates = true
            })
        }
        // cast(d): author was replaced with a list above
        const authorsRemoved = libraryItem.media.authors.filter((a) => !(matchData.author as string[]).find((ma) => ma.toLowerCase() === a.name.toLowerCase()))
        if (authorsRemoved.length) {
          for (const author of authorsRemoved) {
            await Database.bookAuthorModel.destroy({ where: { authorId: author.id, bookId: libraryItem.media.id } })
            libraryItem.media.authors = libraryItem.media.authors.filter((a) => a.id !== author.id)
            authorIdsRemoved.push(author.id)
            Logger.info(`[Scanner] quickMatchBookBuildUpdatePayload: Removed author "${author.name}" from "${libraryItem.media.title}"`)
          }
          hasAuthorUpdates = true
        }
      }

      // For all authors removed from book, check if they are empty now and should be removed
      if (authorIdsRemoved.length) {
        await apiRouterCtx.checkRemoveAuthorsWithNoBooks(authorIdsRemoved)
      }
    }

    // Add or set series if not set
    let hasSeriesUpdates = false
    if (matchData.series && (!libraryItem.media.seriesName || options.overrideDetails)) {
      if (!Array.isArray(matchData.series)) matchData.series = [{ series: matchData.series, sequence: matchData.sequence }]
      const seriesIdsRemoved: string[] = []
      for (const seriesMatchItem of matchData.series) {
        const existingSeries = libraryItem.media.series.find((s) => s.name.toLowerCase() === seriesMatchItem.series.toLowerCase())
        if (existingSeries) {
          if (existingSeries.bookSeries.sequence !== seriesMatchItem.sequence) {
            // cast(d): a match without a sequence (undefined) is saved as null, as in the JS
            existingSeries.bookSeries.sequence = seriesMatchItem.sequence as string | null
            await existingSeries.bookSeries.save()
            Logger.info(`[Scanner] quickMatchBookBuildUpdatePayload: Updated series sequence for "${existingSeries.name}" to ${seriesMatchItem.sequence} in "${libraryItem.media.title}"`)
            hasSeriesUpdates = true
          }
        } else {
          let seriesItem = await Database.seriesModel.getByNameAndLibrary(seriesMatchItem.series, libraryItem.libraryId)
          if (!seriesItem) {
            seriesItem = await Database.seriesModel.create({
              name: seriesMatchItem.series,
              nameIgnorePrefix: getTitleIgnorePrefix(seriesMatchItem.series),
              libraryId: libraryItem.libraryId
            })
            // Update filter data
            Database.addSeriesToFilterData(libraryItem.libraryId, seriesItem.name, seriesItem.id)
            SocketAuthority.emitter('series_added', seriesItem.toOldJSON())
          }
          const bookSeries = await Database.bookSeriesModel.create({
            seriesId: seriesItem.id,
            bookId: libraryItem.media.id,
            sequence: seriesMatchItem.sequence
          })
          seriesItem.bookSeries = bookSeries
          libraryItem.media.series.push(seriesItem)
          Logger.info(`[Scanner] quickMatchBookBuildUpdatePayload: Added series "${seriesItem.name}" to "${libraryItem.media.title}"`)
          hasSeriesUpdates = true
        }
        // cast(d): series was replaced with a list above
        const seriesRemoved = libraryItem.media.series.filter((s) => !(matchData.series as SeriesResult[]).find((ms) => ms.series.toLowerCase() === s.name.toLowerCase()))
        if (seriesRemoved.length) {
          for (const series of seriesRemoved) {
            await series.bookSeries.destroy()
            libraryItem.media.series = libraryItem.media.series.filter((s) => s.id !== series.id)
            seriesIdsRemoved.push(series.id)
            Logger.info(`[Scanner] quickMatchBookBuildUpdatePayload: Removed series "${series.name}" from "${libraryItem.media.title}"`)
          }
          hasSeriesUpdates = true
        }
      }

      // For all series removed from book, check if it is empty now and should be removed
      if (seriesIdsRemoved.length) {
        await apiRouterCtx.checkRemoveEmptySeries(seriesIdsRemoved)
      }
    }

    return {
      updatePayload,
      hasSeriesUpdates,
      hasAuthorUpdates
    }
  }

  /**
   * @returns Number of episodes updated
   */
  async quickMatchPodcastEpisodes(libraryItem: LibraryItem.PodcastLibraryItem, options: QuickMatchOptions = {}): Promise<number> {
    const episodesToQuickMatch: PodcastEpisode[] = libraryItem.media.podcastEpisodes.filter((ep) => !ep.enclosureURL) // Only quick match episodes that are not already matched
    if (!episodesToQuickMatch.length) return 0

    // Only called for podcasts with a feed url
    const feed = await getPodcastFeed(libraryItem.media.feedURL!)
    if (!feed) {
      Logger.error(`[Scanner] quickMatchPodcastEpisodes: Unable to quick match episodes feed not found for "${libraryItem.media.feedURL}"`)
      return 0
    }

    let numEpisodesUpdated = 0
    for (const episode of episodesToQuickMatch) {
      // Episodes without an enclosure url were scanned from audio files, which give them a title (the title tag or the file name)
      const episodeMatches = findMatchingEpisodesInFeed(feed, episode.title!, 0.1)
      if (episodeMatches?.length) {
        const wasUpdated = await this.updateEpisodeWithMatch(episode, episodeMatches[0].episode, options)
        if (wasUpdated) numEpisodesUpdated++
      }
    }
    if (numEpisodesUpdated) {
      Logger.info(`[Scanner] quickMatchPodcastEpisodes: Updated ${numEpisodesUpdated} episodes for "${libraryItem.media.title}"`)
    }
    return numEpisodesUpdated
  }

  /**
   * @returns true if episode was updated
   */
  async updateEpisodeWithMatch(episode: PodcastEpisode, episodeToMatch: RssPodcastEpisode, options: QuickMatchOptions = {}): Promise<boolean> {
    Logger.debug(`[Scanner] quickMatchPodcastEpisodes: Found episode match for "${episode.title}" => ${episodeToMatch.title}`)
    const matchDataTransformed = {
      title: episodeToMatch.title || '',
      subtitle: episodeToMatch.subtitle || '',
      description: episodeToMatch.description || '',
      enclosureURL: episodeToMatch.enclosure?.url || null,
      enclosureSize: episodeToMatch.enclosure?.length || null,
      enclosureType: episodeToMatch.enclosure?.type || null,
      episode: episodeToMatch.episode || '',
      episodeType: episodeToMatch.episodeType || 'full',
      season: episodeToMatch.season || '',
      pubDate: episodeToMatch.pubDate || '',
      publishedAt: episodeToMatch.publishedAt
    }
    const updatePayload: Record<string, unknown> = {}
    for (const key in matchDataTransformed) {
      if (getKey(matchDataTransformed, key)) {
        if (getKey(episode, key) !== getKey(matchDataTransformed, key) && (!getKey(episode, key) || options.overrideDetails)) {
          updatePayload[key] = getKey(matchDataTransformed, key)
        }
      }
    }

    if (Object.keys(updatePayload).length) {
      episode.set(updatePayload)
      if (episode.changed()) {
        Logger.debug(`[Scanner] quickMatchPodcastEpisodes: Updating episode "${episode.title}" keys`, episode.changed())
        await episode.save()
        return true
      }
    }
    return false
  }

  /**
   * Quick match library items
   *
   * @returns false if scan canceled
   */
  async matchLibraryItemsChunk(apiRouterCtx: ApiRouter, library: Library, libraryItems: LibraryItem.BookLibraryItem[], libraryScan: LibraryScan): Promise<boolean> {
    for (let i = 0; i < libraryItems.length; i++) {
      const libraryItem = libraryItems[i]

      if (libraryItem.media.asin && library.settings.skipMatchingMediaWithAsin) {
        Logger.debug(`[Scanner] matchLibraryItems: Skipping "${libraryItem.media.title}" because it already has an ASIN (${i + 1} of ${libraryItems.length})`)
        continue
      }

      if (libraryItem.media.isbn && library.settings.skipMatchingMediaWithIsbn) {
        Logger.debug(`[Scanner] matchLibraryItems: Skipping "${libraryItem.media.title}" because it already has an ISBN (${i + 1} of ${libraryItems.length})`)
        continue
      }

      Logger.debug(`[Scanner] matchLibraryItems: Quick matching "${libraryItem.media.title}" (${i + 1} of ${libraryItems.length})`)
      const result = await this.quickMatchLibraryItem(apiRouterCtx, libraryItem, { provider: library.provider })
      if (result.warning) {
        Logger.warn(`[Scanner] matchLibraryItems: Match warning ${result.warning} for library item "${libraryItem.media.title}"`)
      } else if (result.updated) {
        libraryScan.resultsUpdated++
      }

      if (LibraryScanner.cancelLibraryScan[libraryScan.libraryId]) {
        Logger.info(`[Scanner] matchLibraryItems: Library match scan canceled for "${libraryScan.libraryName}"`)
        return false
      }
    }

    return true
  }

  /**
   * Quick match all library items for library
   */
  async matchLibraryItems(apiRouterCtx: ApiRouter, library: Library) {
    if (library.mediaType === 'podcast') {
      Logger.error(`[Scanner] matchLibraryItems: Match all not supported for podcasts yet`)
      return
    }

    if (LibraryScanner.isLibraryScanning(library.id)) {
      Logger.error(`[Scanner] Library "${library.name}" is already scanning`)
      return
    }

    const limit = 100
    let offset = 0

    const libraryScan = new LibraryScan()
    libraryScan.setData(library, 'match')
    LibraryScanner.librariesScanning.push(libraryScan.libraryId)
    const taskData = {
      libraryId: library.id
    }
    const taskTitleString = {
      text: `Matching books in "${library.name}"`,
      key: 'MessageTaskMatchingBooksInLibrary',
      subs: [library.name]
    }
    const task = TaskManager.createAndAddTask('library-match-all', taskTitleString, null, true, taskData)
    Logger.info(`[Scanner] matchLibraryItems: Starting library match scan ${libraryScan.id} for ${libraryScan.libraryName}`)

    let hasMoreChunks = true
    let isCanceled = false
    while (hasMoreChunks) {
      const libraryItems = await Database.libraryItemModel.getLibraryItemsIncrement(offset, limit, { libraryId: library.id })
      if (!libraryItems.length) {
        break
      }

      offset += limit
      hasMoreChunks = libraryItems.length === limit

      // cast(d): podcast libraries return above, so these are book library items (getLibraryItemsIncrement includes the media)
      const shouldContinue = await this.matchLibraryItemsChunk(apiRouterCtx, library, libraryItems as LibraryItem.BookLibraryItem[], libraryScan)
      if (!shouldContinue) {
        isCanceled = true
        break
      }
    }

    if (offset === 0) {
      Logger.error(`[Scanner] matchLibraryItems: Library has no items ${library.id}`)
      libraryScan.setComplete()
      const taskFailedString = {
        text: 'No items found',
        key: 'MessageNoItemsFound'
      }
      task.setFailed(taskFailedString)
    } else {
      libraryScan.setComplete()

      // Set by createAndAddTask
      task.data!.scanResults = libraryScan.scanResults
      if (isCanceled) {
        const taskFinishedString = {
          text: 'Task canceled by user',
          key: 'MessageTaskCanceledByUser'
        }
        task.setFinished(taskFinishedString)
      } else {
        task.setFinished(null, true)
      }
    }

    delete LibraryScanner.cancelLibraryScan[libraryScan.libraryId]
    LibraryScanner.librariesScanning = LibraryScanner.librariesScanning.filter((lid) => lid !== library.id)
    TaskManager.taskFinished(task)
  }
}
export = new Scanner()
