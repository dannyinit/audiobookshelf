import Path = require('path')
import Sequelize = require('sequelize')
import type { Attributes, BelongsToGetAssociationMixin, Includeable, BindOrReplacements, CreationOptional, FindOptions, IncludeOptions, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute, WhereOptions } from 'sequelize'
import fsExtraModule = require('../libs/fsExtra')
import Logger = require('../Logger')
import libraryFilters = require('../utils/queries/libraryFilters')
import fileUtils = require('../utils/fileUtils')
import LibraryFile = require('../objects/files/LibraryFile')
// Required at load as in the JS (only their types are used here)
import './Book'
import './Podcast'
import type { FsExtra } from '../utils/types'
import type Author = require('./Author')
import type Book = require('./Book')
import type Feed = require('./Feed')
import type Library = require('./Library')
import type Podcast = require('./Podcast')
import type User = require('./User')
import type { AudioFileObject, AudioTrack, LibraryFileObject, LibraryItemExtraData, ModelsSequelize } from './types'
import type * as ModelTypes from './types'
const { DataTypes, Model } = Sequelize
// cast(a): the vendored fs-extra builds its fs API at runtime, so its inferred type lacks most fs methods
const fsExtra = fsExtraModule as unknown as FsExtra
const { filePathToPOSIX, getFileTimestampsWithIno } = fileUtils

/**
 * Options of libraryFilters.getFilteredLibraryItems (sent by the client)
 */
type FilterAndSortOptions = Parameters<(typeof libraryFilters)['getFilteredLibraryItems']>[2]

/**
 * Shelf of the personalized home page
 */
interface PersonalizedShelf {
  id: string
  label: string
  labelStringKey: string
  type: string
  entities: unknown[]
  total: number
}

/**
 * Library item JSON on a shelf, with the media properties the shelves filter on (only books have ebookFormat and numTracks)
 */
interface ShelfMediaItemJson {
  mediaType: string
  media: { metadata: object; ebookFormat?: string; numTracks?: number }
}

/**
 * dataValues of a loaded library item with the included media (moved to media by the afterFind hook)
 */
type LibraryItemDataValues = InferAttributes<LibraryItem> & {
  book?: Book
  podcast?: Podcast
  media?: Book | Podcast
}

/**
 * Attributes accepted by create: mtime, ctime and birthtime may be epoch ms (the DATE columns convert them to Dates)
 */
type LibraryItemCreationAttributes = InferCreationAttributes<LibraryItem, { omit: 'mtime' | 'ctime' | 'birthtime' }> & {
  mtime: Date | number | null
  ctime: Date | number | null
  birthtime: Date | number | null
}

/**
 * mtime, ctime and birthtime are read as Dates (or null). They are also set to epoch ms (file timestamps),
 * which the DATE(6) columns convert to Dates.
 */
interface LibraryItem {
  get mtime(): Date | null
  set mtime(value: Date | number | null)
  get ctime(): Date | null
  set ctime(value: Date | number | null)
  get birthtime(): Date | null
  set birthtime(value: Date | number | null)
}

class LibraryItem extends Model<InferAttributes<LibraryItem>, LibraryItemCreationAttributes> {
  declare id: CreationOptional<string>
  declare ino: string
  declare path: string
  declare relPath: string
  declare mediaId: string
  declare mediaType: string
  declare isFile: boolean
  declare isMissing: boolean
  declare isInvalid: boolean
  /** BIGINT column, a number in sqlite (total size of the library files) */
  declare size: number
  declare lastScan: Date | null
  declare lastScanVersion: string | null
  declare libraryFiles: LibraryFileObject[]
  declare extraData: LibraryItemExtraData | null
  declare libraryId: string
  declare libraryFolderId: string
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  /** Only used for sorting */
  declare title: string | null
  /** Only used for sorting */
  declare titleIgnorePrefix: string | null
  /** Only used for sorting */
  declare authorNamesFirstLast: string | null
  /** Only used for sorting */
  declare authorNamesLastFirst: string | null

  declare sequelize: ModelsSequelize
  declare static readonly sequelize: ModelsSequelize

  // Expanded properties

  /** only set when expanded */
  declare media: NonAttribute<Book | Podcast>

  // Associations, only set when included (the afterFind hook moves book or podcast to media and deletes them)

  declare book?: NonAttribute<Book>
  declare podcast?: NonAttribute<Podcast>
  declare library?: NonAttribute<Library>

  declare getBook: BelongsToGetAssociationMixin<Book>
  declare getPodcast: BelongsToGetAssociationMixin<Podcast>

  /**
   * Gets library items partially expanded, not including podcast episodes
   * @todo temporary solution
   */
  static getLibraryItemsIncrement(offset: number, limit: number, where: WhereOptions<LibraryItem> | null = null): Promise<LibraryItem[]> {
    return this.findAll({
      // cast(b): sequelize accepts a null where (no condition), its types do not
      where: where as WhereOptions<LibraryItem>,
      include: [
        {
          model: this.sequelize.models.book,
          include: [
            {
              model: this.sequelize.models.author,
              through: {
                attributes: ['createdAt']
              }
            },
            {
              model: this.sequelize.models.series,
              through: {
                attributes: ['id', 'sequence', 'createdAt']
              }
            }
          ]
        },
        {
          model: this.sequelize.models.podcast
        }
      ],
      order: [
        ['createdAt', 'ASC'],
        // Ensure author & series stay in the same order
        [this.sequelize.models.book, this.sequelize.models.author, this.sequelize.models.bookAuthor, 'createdAt', 'ASC'],
        [this.sequelize.models.book, this.sequelize.models.series, 'bookSeries', 'createdAt', 'ASC']
      ],
      offset,
      limit
    })
  }

  /**
   * Remove library item by id
   *
   * @returns The number of destroyed rows
   */
  static removeById(libraryItemId: string): Promise<number> {
    return this.destroy({
      where: {
        id: libraryItemId
      },
      individualHooks: true
    })
  }

  static async findAllExpandedWhere(where: WhereOptions<LibraryItem> | null = null): Promise<LibraryItem.LibraryItemExpanded[]> {
    return this.findAll({
      // cast(b): sequelize accepts a null where (no condition), its types do not
      where: where as WhereOptions<LibraryItem>,
      include: [
        {
          model: this.sequelize.models.book,
          include: [
            {
              model: this.sequelize.models.author,
              through: {
                attributes: []
              }
            },
            {
              model: this.sequelize.models.series,
              through: {
                attributes: ['id', 'sequence']
              }
            }
          ]
        },
        {
          model: this.sequelize.models.podcast,
          include: {
            model: this.sequelize.models.podcastEpisode
          }
        }
        // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
      ] as unknown as Includeable[],
      order: [
        // Ensure author & series stay in the same order
        [this.sequelize.models.book, this.sequelize.models.author, this.sequelize.models.bookAuthor, 'createdAt', 'ASC'],
        [this.sequelize.models.book, this.sequelize.models.series, 'bookSeries', 'createdAt', 'ASC']
      ]
      // cast(b): the books and podcasts are included, so the afterFind hook sets each media for its mediaType
    }) as Promise<LibraryItem.LibraryItemExpanded[]>
  }

  static async getExpandedById(libraryItemId: string): Promise<LibraryItem.LibraryItemExpanded | null> {
    if (!libraryItemId) return null

    const libraryItem = await this.findByPk(libraryItemId)
    if (!libraryItem) {
      Logger.error(`[LibraryItem] Library item not found with id "${libraryItemId}"`)
      return null
    }

    if (libraryItem.mediaType === 'podcast') {
      libraryItem.media = (await libraryItem.getMedia({
        include: [
          {
            model: this.sequelize.models.podcastEpisode
          }
        ]
        // cast(d): a null media is checked below, and then the library item is not returned
      })) as Book | Podcast
    } else {
      libraryItem.media = (await libraryItem.getMedia({
        include: [
          {
            model: this.sequelize.models.author,
            through: {
              attributes: []
            }
          },
          {
            model: this.sequelize.models.series,
            through: {
              attributes: ['id', 'sequence']
            }
          }
        ],
        order: [
          [this.sequelize.models.author, this.sequelize.models.bookAuthor, 'createdAt', 'ASC'],
          [this.sequelize.models.series, 'bookSeries', 'createdAt', 'ASC']
        ]
        // cast(d): a null media is checked below, and then the library item is not returned
      })) as Book | Podcast
    }

    if (!libraryItem.media) return null
    // cast(d): media was loaded above for the mediaType (book or podcast)
    return libraryItem as LibraryItem.LibraryItemExpanded
  }

  /**
   * @param [replacements]
   * @param [include]
   */
  static async findOneExpanded(where: WhereOptions<LibraryItem>, replacements: BindOrReplacements | null = null, include: IncludeOptions | null = null): Promise<LibraryItem.LibraryItemExpanded | null> {
    const libraryItem = await this.findOne({
      where,
      // cast(b): sequelize accepts null replacements and include (none), its types do not
      replacements: replacements as BindOrReplacements,
      // cast(b): sequelize accepts null replacements and include (none), its types do not
      include: include as IncludeOptions
    })
    if (!libraryItem) {
      return null
    }

    if (libraryItem.mediaType === 'podcast') {
      libraryItem.media = (await libraryItem.getMedia({
        include: [
          {
            model: this.sequelize.models.podcastEpisode
          }
        ]
        // cast(d): a null media is checked below, and then the library item is not returned
      })) as Book | Podcast
    } else {
      libraryItem.media = (await libraryItem.getMedia({
        include: [
          {
            model: this.sequelize.models.author,
            through: {
              attributes: []
            }
          },
          {
            model: this.sequelize.models.series,
            through: {
              attributes: ['id', 'sequence']
            }
          }
        ],
        order: [
          [this.sequelize.models.author, this.sequelize.models.bookAuthor, 'createdAt', 'ASC'],
          [this.sequelize.models.series, 'bookSeries', 'createdAt', 'ASC']
        ]
        // cast(d): a null media is checked below, and then the library item is not returned
      })) as Book | Podcast
    }

    if (!libraryItem.media) return null
    // cast(d): media was loaded above for the mediaType (book or podcast)
    return libraryItem as LibraryItem.LibraryItemExpanded
  }

  /**
   * Get library items using filter and sort
   */
  static async getByFilterAndSort(library: Library, user: User, options: FilterAndSortOptions) {
    let start = Date.now()
    const { libraryItems, count } = await libraryFilters.getFilteredLibraryItems(library.id, user, options)
    Logger.debug(`Loaded ${libraryItems.length} of ${count} items for libary page in ${((Date.now() - start) / 1000).toFixed(2)}s`)

    return {
      libraryItems: libraryItems.map((li) => {
        // Typed with the properties added below
        const oldLibraryItem: ReturnType<LibraryItem['toOldJSONMinified']> & {
          collapsedSeries?: unknown
          rssFeed?: ReturnType<Feed['toOldJSONMinified']>
          numEpisodesIncomplete?: number
          mediaItemShare?: unknown
          media: { metadata: { series?: unknown }; numEpisodes?: number; size?: number }
        } = li.toOldJSONMinified()
        if (li.collapsedSeries) {
          oldLibraryItem.collapsedSeries = li.collapsedSeries
        }
        if (li.series) {
          oldLibraryItem.media.metadata.series = li.series
        }
        if (li.rssFeed) {
          oldLibraryItem.rssFeed = li.rssFeed.toOldJSONMinified()
        }
        // Same object as li.media; only podcasts have numEpisodes
        const media: { id: string; numEpisodes?: number | null } = li.media
        if (media.numEpisodes) {
          oldLibraryItem.media.numEpisodes = media.numEpisodes
        }
        if (li.size && !oldLibraryItem.media.size) {
          oldLibraryItem.media.size = li.size
        }
        if (li.numEpisodesIncomplete) {
          oldLibraryItem.numEpisodesIncomplete = li.numEpisodesIncomplete
        }
        if (li.mediaItemShare) {
          oldLibraryItem.mediaItemShare = li.mediaItemShare
        }

        return oldLibraryItem
      }),
      count
    }
  }

  /**
   * Get home page data personalized shelves
   */
  static async getPersonalizedShelves(library: Library, user: User, include: string[], limit: number): Promise<PersonalizedShelf[]> {
    const fullStart = Date.now() // Used for testing load times

    const shelves: PersonalizedShelf[] = []

    const timed = async <T>(loader: () => Promise<T>) => {
      const start = Date.now()
      const payload = await loader()
      return {
        payload,
        elapsedSeconds: ((Date.now() - start) / 1000).toFixed(2)
      }
    }

    // "Continue Listening" shelf
    // The JS passed a fifth argument (false), which getMediaItemsInProgress does not take (it was ignored)
    const itemsInProgressPayload = await libraryFilters.getMediaItemsInProgress(library, user, include, limit)
    if (itemsInProgressPayload.items.length) {
      const ebookOnlyItemsInProgress = itemsInProgressPayload.items.filter((li: ShelfMediaItemJson) => li.media.ebookFormat && !li.media.numTracks)
      const audioItemsInProgress = itemsInProgressPayload.items.filter((li: ShelfMediaItemJson) => li.media.numTracks || li.mediaType === 'podcast')

      if (audioItemsInProgress.length) {
        shelves.push({
          id: 'continue-listening',
          label: 'Continue Listening',
          labelStringKey: 'LabelContinueListening',
          type: library.isPodcast ? 'episode' : 'book',
          entities: audioItemsInProgress,
          total: itemsInProgressPayload.count
        })
      }

      if (ebookOnlyItemsInProgress.length) {
        // "Continue Reading" shelf
        shelves.push({
          id: 'continue-reading',
          label: 'Continue Reading',
          labelStringKey: 'LabelContinueReading',
          type: 'book',
          entities: ebookOnlyItemsInProgress,
          total: itemsInProgressPayload.count
        })
      }
    }
    Logger.debug(`Loaded ${itemsInProgressPayload.items.length} of ${itemsInProgressPayload.count} items for "Continue Listening/Reading" in ${((Date.now() - fullStart) / 1000).toFixed(2)}s`)

    if (library.isBook) {
      const [continueSeriesResult, mostRecentResult, seriesMostRecentResult, discoverResult, mediaFinishedResult, newestAuthorsResult] = await Promise.all([
        timed(() => libraryFilters.getLibraryItemsContinueSeries(library, user, include, limit)),
        timed(() => libraryFilters.getLibraryItemsMostRecentlyAdded(library, user, include, limit)),
        timed(() => libraryFilters.getSeriesMostRecentlyAdded(library, user, include, 5)),
        timed(() => libraryFilters.getLibraryItemsToDiscover(library, user, include, limit)),
        timed(() => libraryFilters.getMediaFinished(library, user, include, limit)),
        timed(() => libraryFilters.getNewestAuthors(library, user, limit))
      ])

      const continueSeriesPayload = continueSeriesResult.payload
      // "Continue Series" shelf
      if (continueSeriesPayload.libraryItems.length) {
        shelves.push({
          id: 'continue-series',
          label: 'Continue Series',
          labelStringKey: 'LabelContinueSeries',
          type: 'book',
          entities: continueSeriesPayload.libraryItems,
          total: continueSeriesPayload.count
        })
      }
      Logger.debug(`Loaded ${continueSeriesPayload.libraryItems.length} of ${continueSeriesPayload.count} items for "Continue Series" in ${continueSeriesResult.elapsedSeconds}s`)

      const mostRecentPayload = mostRecentResult.payload
      // "Recently Added" shelf
      if (mostRecentPayload.libraryItems.length) {
        shelves.push({
          id: 'recently-added',
          label: 'Recently Added',
          labelStringKey: 'LabelRecentlyAdded',
          type: library.mediaType,
          entities: mostRecentPayload.libraryItems,
          total: mostRecentPayload.count
        })
      }
      Logger.debug(`Loaded ${mostRecentPayload.libraryItems.length} of ${mostRecentPayload.count} items for "Recently Added" in ${mostRecentResult.elapsedSeconds}s`)

      const seriesMostRecentPayload = seriesMostRecentResult.payload
      // "Recent Series" shelf
      if (seriesMostRecentPayload.series.length) {
        shelves.push({
          id: 'recent-series',
          label: 'Recent Series',
          labelStringKey: 'LabelRecentSeries',
          type: 'series',
          entities: seriesMostRecentPayload.series,
          total: seriesMostRecentPayload.count
        })
      }
      Logger.debug(`Loaded ${seriesMostRecentPayload.series.length} of ${seriesMostRecentPayload.count} series for "Recent Series" in ${seriesMostRecentResult.elapsedSeconds}s`)

      const discoverLibraryItemsPayload = discoverResult.payload
      // "Discover" shelf
      if (discoverLibraryItemsPayload.libraryItems.length) {
        shelves.push({
          id: 'discover',
          label: 'Discover',
          labelStringKey: 'LabelDiscover',
          type: library.mediaType,
          entities: discoverLibraryItemsPayload.libraryItems,
          total: discoverLibraryItemsPayload.count
        })
      }
      Logger.debug(`Loaded ${discoverLibraryItemsPayload.libraryItems.length} of ${discoverLibraryItemsPayload.count} items for "Discover" in ${discoverResult.elapsedSeconds}s`)

      const mediaFinishedPayload = mediaFinishedResult.payload
      // "Listen Again" shelf
      if (mediaFinishedPayload.items.length) {
        const ebookOnlyItemsInProgress = mediaFinishedPayload.items.filter((li: ShelfMediaItemJson) => li.media.ebookFormat && !li.media.numTracks)
        const audioItemsInProgress = mediaFinishedPayload.items.filter((li: ShelfMediaItemJson) => li.media.numTracks || li.mediaType === 'podcast')

        if (audioItemsInProgress.length) {
          shelves.push({
            id: 'listen-again',
            label: 'Listen Again',
            labelStringKey: 'LabelListenAgain',
            type: library.isPodcast ? 'episode' : 'book',
            entities: audioItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }

        if (ebookOnlyItemsInProgress.length) {
          // "Read Again" shelf
          shelves.push({
            id: 'read-again',
            label: 'Read Again',
            labelStringKey: 'LabelReadAgain',
            type: 'book',
            entities: ebookOnlyItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }
      }
      Logger.debug(`Loaded ${mediaFinishedPayload.items.length} of ${mediaFinishedPayload.count} items for "Listen/Read Again" in ${mediaFinishedResult.elapsedSeconds}s`)

      const newestAuthorsPayload = newestAuthorsResult.payload
      // "Newest Authors" shelf
      if (newestAuthorsPayload.authors.length) {
        shelves.push({
          id: 'newest-authors',
          label: 'Newest Authors',
          labelStringKey: 'LabelNewestAuthors',
          type: 'authors',
          entities: newestAuthorsPayload.authors,
          total: newestAuthorsPayload.count
        })
      }
      Logger.debug(`Loaded ${newestAuthorsPayload.authors.length} of ${newestAuthorsPayload.count} authors for "Newest Authors" in ${newestAuthorsResult.elapsedSeconds}s`)
    } else if (library.isPodcast) {
      const [newestEpisodesResult, mostRecentResult, mediaFinishedResult] = await Promise.all([timed(() => libraryFilters.getNewestPodcastEpisodes(library, user, limit)), timed(() => libraryFilters.getLibraryItemsMostRecentlyAdded(library, user, include, limit)), timed(() => libraryFilters.getMediaFinished(library, user, include, limit))])

      const newestEpisodesPayload = newestEpisodesResult.payload
      // "Newest Episodes" shelf
      if (newestEpisodesPayload.libraryItems.length) {
        shelves.push({
          id: 'newest-episodes',
          label: 'Newest Episodes',
          labelStringKey: 'LabelNewestEpisodes',
          type: 'episode',
          entities: newestEpisodesPayload.libraryItems,
          total: newestEpisodesPayload.count
        })
      }
      Logger.debug(`Loaded ${newestEpisodesPayload.libraryItems.length} of ${newestEpisodesPayload.count} episodes for "Newest Episodes" in ${newestEpisodesResult.elapsedSeconds}s`)

      const mostRecentPayload = mostRecentResult.payload
      // "Recently Added" shelf
      if (mostRecentPayload.libraryItems.length) {
        shelves.push({
          id: 'recently-added',
          label: 'Recently Added',
          labelStringKey: 'LabelRecentlyAdded',
          type: library.mediaType,
          entities: mostRecentPayload.libraryItems,
          total: mostRecentPayload.count
        })
      }
      Logger.debug(`Loaded ${mostRecentPayload.libraryItems.length} of ${mostRecentPayload.count} items for "Recently Added" in ${mostRecentResult.elapsedSeconds}s`)

      const mediaFinishedPayload = mediaFinishedResult.payload
      // "Listen Again" shelf
      if (mediaFinishedPayload.items.length) {
        const ebookOnlyItemsInProgress = mediaFinishedPayload.items.filter((li: ShelfMediaItemJson) => li.media.ebookFormat && !li.media.numTracks)
        const audioItemsInProgress = mediaFinishedPayload.items.filter((li: ShelfMediaItemJson) => li.media.numTracks || li.mediaType === 'podcast')

        if (audioItemsInProgress.length) {
          shelves.push({
            id: 'listen-again',
            label: 'Listen Again',
            labelStringKey: 'LabelListenAgain',
            type: 'episode',
            entities: audioItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }

        if (ebookOnlyItemsInProgress.length) {
          // "Read Again" shelf
          shelves.push({
            id: 'read-again',
            label: 'Read Again',
            labelStringKey: 'LabelReadAgain',
            type: 'book',
            entities: ebookOnlyItemsInProgress,
            total: mediaFinishedPayload.count
          })
        }
      }
      Logger.debug(`Loaded ${mediaFinishedPayload.items.length} of ${mediaFinishedPayload.count} items for "Listen/Read Again" in ${mediaFinishedResult.elapsedSeconds}s`)
    }

    Logger.debug(`Loaded ${shelves.length} personalized shelves in ${((Date.now() - fullStart) / 1000).toFixed(2)}s`)

    return shelves
  }

  /**
   * Get book library items for author, optional use user permissions
   */
  static async getForAuthor(author: Author, user: User | null = null) {
    // cast(d): libraryFilters types limit and offset as numbers; undefined (no limit, no offset) is passed on to the query, as in the JS
    const { libraryItems } = await libraryFilters.getLibraryItemsForAuthor(author, user, undefined as unknown as number, undefined as unknown as number)
    return libraryItems
  }

  /**
   * Check if library item exists
   */
  static async checkExistsById(libraryItemId: string): Promise<boolean> {
    return (await this.count({ where: { id: libraryItemId } })) > 0
  }

  static async getCoverPath(libraryItemId: string): Promise<string | null> {
    const libraryItem = await this.findByPk(libraryItemId, {
      attributes: ['id', 'mediaType', 'mediaId', 'libraryId'],
      include: [
        {
          model: this.sequelize.models.book,
          attributes: ['id', 'coverPath']
        },
        {
          model: this.sequelize.models.podcast,
          attributes: ['id', 'coverPath']
        }
      ]
    })
    if (!libraryItem) {
      Logger.warn(`[LibraryItem] getCoverPath: Library item "${libraryItemId}" does not exist`)
      return null
    }

    return libraryItem.media.coverPath
  }

  async saveMetadataFile(): Promise<LibraryFileObject | null | undefined> {
    let metadataPath = Path.join(global.MetadataPath, 'items', this.id)
    let storeMetadataWithItem = global.ServerSettings.storeMetadataWithItem
    if (storeMetadataWithItem && !this.isFile) {
      metadataPath = this.path
    } else {
      // Make sure metadata book dir exists
      storeMetadataWithItem = false
      await fsExtra.ensureDir(metadataPath)
    }

    const metadataFilePath = Path.join(metadataPath, `metadata.${global.ServerSettings.metadataFileFormat}`)

    // Expanded with series, authors, podcastEpisodes
    const mediaExpanded = this.media || (await this.getMediaExpanded())

    let jsonObject: object = {}
    if (this.mediaType === 'book') {
      // cast(d): media is a Book when mediaType is "book" (null media throws below, as in the JS)
      const book = mediaExpanded as Book
      jsonObject = {
        tags: book.tags || [],
        chapters: book.chapters?.map((c) => ({ ...c })) || [],
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors.map((a) => a.name),
        narrators: book.narrators,
        series: book.series.map((se) => {
          const sequence = se.bookSeries?.sequence || ''
          if (!sequence) return se.name
          return `${se.name} #${sequence}`
        }),
        genres: book.genres || [],
        publishedYear: book.publishedYear,
        publishedDate: book.publishedDate,
        publisher: book.publisher,
        description: book.description,
        isbn: book.isbn,
        asin: book.asin,
        language: book.language,
        explicit: !!book.explicit,
        abridged: !!book.abridged
      }
    } else {
      // cast(d): media is a Podcast when mediaType is not "book" (null media throws below, as in the JS)
      const podcast = mediaExpanded as Podcast
      jsonObject = {
        tags: podcast.tags || [],
        title: podcast.title,
        author: podcast.author,
        description: podcast.description,
        releaseDate: podcast.releaseDate,
        genres: podcast.genres || [],
        feedURL: podcast.feedURL,
        imageURL: podcast.imageURL,
        itunesPageURL: podcast.itunesPageURL,
        itunesId: podcast.itunesId,
        itunesArtistId: podcast.itunesArtistId,
        // NOTE: Podcast has no asin, so this is always undefined (and left out of the JSON)
        // cast(c): the JS reads asin on the podcast; see the NOTE above
        asin: (podcast as Podcast & { asin?: string }).asin,
        language: podcast.language,
        explicit: !!podcast.explicit,
        podcastType: podcast.podcastType
      }
    }

    return fsExtra
      .writeFile(metadataFilePath, JSON.stringify(jsonObject, null, 2))
      .then(async () => {
        // Add metadata.json to libraryFiles array if it is new
        let metadataLibraryFile = this.libraryFiles.find((lf) => lf.metadata.path === filePathToPOSIX(metadataFilePath))
        if (storeMetadataWithItem) {
          if (!metadataLibraryFile) {
            const newLibraryFile = new LibraryFile()
            await newLibraryFile.setDataFromPath(metadataFilePath, `metadata.json`)
            metadataLibraryFile = newLibraryFile.toJSON()
            this.libraryFiles.push(metadataLibraryFile)
          } else {
            const fileTimestamps = await getFileTimestampsWithIno(metadataFilePath)
            if (fileTimestamps) {
              metadataLibraryFile.metadata.mtimeMs = fileTimestamps.mtimeMs
              metadataLibraryFile.metadata.ctimeMs = fileTimestamps.ctimeMs
              metadataLibraryFile.metadata.size = fileTimestamps.size
              metadataLibraryFile.ino = fileTimestamps.ino
            }
          }
          const libraryItemDirTimestamps = await getFileTimestampsWithIno(this.path)
          if (libraryItemDirTimestamps) {
            this.mtime = libraryItemDirTimestamps.mtimeMs
            this.ctime = libraryItemDirTimestamps.ctimeMs
            let size = 0
            this.libraryFiles.forEach((lf) => (size += !isNaN(lf.metadata.size) ? Number(lf.metadata.size) : 0))
            this.size = size
            await this.save()
          }
        }

        Logger.debug(`[LibraryItem] Saved metadata for "${this.media.title}" file to "${metadataFilePath}"`)

        return metadataLibraryFile
      })
      .catch((error) => {
        Logger.error(`Failed to save json file at "${metadataFilePath}"`, error)
        return null
      })
  }

  /**
   * Initialize model
   */
  static init(sequelize: ModelsSequelize): void
  // Model.init signature, only declared so the class stays assignable to Model (Database calls init(sequelize))
  static init<MS extends ModelStatic<Sequelize.Model>, M extends InstanceType<MS>>(this: MS, attributes: ModelAttributes<M, Attributes<M>> | ModelsSequelize, options?: InitOptions<M>): MS
  static init(sequelize: ModelsSequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        ino: DataTypes.STRING,
        path: DataTypes.STRING,
        relPath: DataTypes.STRING,
        mediaId: DataTypes.UUID,
        mediaType: DataTypes.STRING,
        isFile: DataTypes.BOOLEAN,
        isMissing: DataTypes.BOOLEAN,
        isInvalid: DataTypes.BOOLEAN,
        mtime: DataTypes.DATE(6),
        ctime: DataTypes.DATE(6),
        birthtime: DataTypes.DATE(6),
        size: DataTypes.BIGINT,
        lastScan: DataTypes.DATE,
        lastScanVersion: DataTypes.STRING,
        libraryFiles: DataTypes.JSON,
        extraData: DataTypes.JSON,
        title: DataTypes.STRING,
        titleIgnorePrefix: DataTypes.STRING,
        authorNamesFirstLast: DataTypes.STRING,
        authorNamesLastFirst: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'libraryItem',
        indexes: [
          {
            fields: ['createdAt']
          },
          {
            fields: ['mediaId']
          },
          {
            fields: ['libraryId', 'mediaType']
          },
          {
            fields: ['libraryId', 'mediaType', 'size']
          },
          {
            fields: ['libraryId', 'mediaType', 'createdAt']
          },
          {
            fields: ['libraryId', 'mediaType', { name: 'title', collate: 'NOCASE' }]
          },
          {
            fields: ['libraryId', 'mediaType', { name: 'titleIgnorePrefix', collate: 'NOCASE' }]
          },
          {
            fields: ['libraryId', 'mediaType', { name: 'authorNamesFirstLast', collate: 'NOCASE' }]
          },
          {
            fields: ['libraryId', 'mediaType', { name: 'authorNamesLastFirst', collate: 'NOCASE' }]
          },
          {
            fields: ['libraryId', 'mediaId', 'mediaType']
          },
          {
            fields: ['birthtime']
          },
          {
            fields: ['mtime']
          }
        ]
      }
    )

    const { library, libraryFolder, book, podcast } = sequelize.models
    library.hasMany(LibraryItem)
    LibraryItem.belongsTo(library)

    libraryFolder.hasMany(LibraryItem)
    LibraryItem.belongsTo(libraryFolder)

    book.hasOne(LibraryItem, {
      foreignKey: 'mediaId',
      constraints: false,
      scope: {
        mediaType: 'book'
      }
    })
    LibraryItem.belongsTo(book, { foreignKey: 'mediaId', constraints: false })

    podcast.hasOne(LibraryItem, {
      foreignKey: 'mediaId',
      constraints: false,
      scope: {
        mediaType: 'podcast'
      }
    })
    LibraryItem.belongsTo(podcast, { foreignKey: 'mediaId', constraints: false })

    LibraryItem.addHook('afterFind', (findResult: LibraryItem[] | LibraryItem | null) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]
      for (const instance of findResult) {
        // Same object as instance.dataValues, typed with the included rows
        const dataValues: LibraryItemDataValues = instance.dataValues
        if (instance.mediaType === 'book' && instance.book !== undefined) {
          instance.media = instance.book
          dataValues.media = dataValues.book
        } else if (instance.mediaType === 'podcast' && instance.podcast !== undefined) {
          instance.media = instance.podcast
          dataValues.media = dataValues.podcast
        }
        // To prevent mistakes:
        delete instance.book
        delete dataValues.book
        delete instance.podcast
        delete dataValues.podcast
      }
    })

    LibraryItem.addHook('afterDestroy', async (instance: LibraryItem) => {
      if (!instance) return
      const media = await instance.getMedia()
      if (media) {
        media.destroy()
      }
    })
  }

  get isBook(): NonAttribute<boolean> {
    return this.mediaType === 'book'
  }
  get isPodcast(): NonAttribute<boolean> {
    return this.mediaType === 'podcast'
  }
  /**
   * Check if book or podcast library item has audio tracks.
   * Requires expanded library item (media loaded).
   */
  get hasAudioTracks(): NonAttribute<boolean> {
    if (!this.media) {
      Logger.error(`[LibraryItem] hasAudioTracks: Library item "${this.id}" does not have media`)
      return false
    }
    return this.media.hasAudioTracks
  }

  getMedia(options?: FindOptions): Promise<Book | Podcast | null> {
    if (!this.mediaType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.mediaType)}`
    // cast(d): mediaType is "book" or "podcast", so the name is one of the association getters
    return this[mixinMethodName as 'getBook' | 'getPodcast'](options)
  }

  getMediaExpanded(): Promise<Book | Podcast | null> {
    if (this.mediaType === 'podcast') {
      return this.getMedia({
        include: [
          {
            model: this.sequelize.models.podcastEpisode
          }
        ]
      })
    } else {
      return this.getMedia({
        include: [
          {
            model: this.sequelize.models.author,
            through: {
              attributes: []
            }
          },
          {
            model: this.sequelize.models.series,
            through: {
              attributes: ['sequence']
            }
          }
        ],
        order: [
          [this.sequelize.models.author, this.sequelize.models.bookAuthor, 'createdAt', 'ASC'],
          [this.sequelize.models.series, 'bookSeries', 'createdAt', 'ASC']
        ]
      })
    }
  }

  getAudioFileWithIno(ino: string): AudioFileObject | null | undefined {
    if (!this.media) {
      Logger.error(`[LibraryItem] getAudioFileWithIno: Library item "${this.id}" does not have media`)
      return null
    }
    if (this.isBook) {
      // cast(d): media is a Book when isBook
      return (this.media as Book).audioFiles.find((af) => af.ino === ino)
    } else {
      // cast(d): media is a Podcast when not isBook
      return (this.media as Podcast).podcastEpisodes.find((pe) => pe.audioFile?.ino === ino)?.audioFile
    }
  }

  /**
   * Get the track list to be used in client audio players
   * AudioTrack is the AudioFile with startOffset and contentUrl
   * Podcasts must have an episodeId to get the track list
   *
   * @param [episodeId]
   */
  getTrackList(episodeId?: string): AudioTrack[] {
    if (!this.media) {
      Logger.error(`[LibraryItem] getTrackList: Library item "${this.id}" does not have media`)
      return []
    }
    // cast(d): book media ignores the episode id; podcasts must have one (see above)
    return this.media.getTracklist(this.id, episodeId as string)
  }

  getLibraryFileWithIno(ino: string): LibraryFile | null {
    const libraryFile = this.libraryFiles.find((lf) => lf.ino === ino)
    if (!libraryFile) return null
    return new LibraryFile(libraryFile)
  }

  getLibraryFiles() {
    return this.libraryFiles.map((lf) => new LibraryFile(lf))
  }

  getLibraryFilesJson() {
    return this.libraryFiles.map((lf) => new LibraryFile(lf).toJSON())
  }

  toOldJSON() {
    if (!this.media) {
      throw new Error(`[LibraryItem] Cannot convert to old JSON without media for library item "${this.id}"`)
    }

    return {
      id: this.id,
      ino: this.ino,
      oldLibraryItemId: this.extraData?.oldLibraryItemId || null,
      libraryId: this.libraryId,
      folderId: this.libraryFolderId,
      path: this.path,
      relPath: this.relPath,
      isFile: this.isFile,
      mtimeMs: this.mtime?.valueOf(),
      ctimeMs: this.ctime?.valueOf(),
      birthtimeMs: this.birthtime?.valueOf(),
      addedAt: this.createdAt.valueOf(),
      updatedAt: this.updatedAt.valueOf(),
      lastScan: this.lastScan?.valueOf(),
      scanVersion: this.lastScanVersion,
      isMissing: !!this.isMissing,
      isInvalid: !!this.isInvalid,
      mediaType: this.mediaType,
      media: this.media.toOldJSON(this.id),
      // LibraryFile JSON includes a fileType property that may not be saved in libraryFiles column in the database
      libraryFiles: this.getLibraryFilesJson()
    }
  }

  /**
   * Minified library item JSON for list/shelf endpoints.
   * `toOldJSONExpanded()` must be a strict superset: every key here must exist in expanded
   * with the same value semantics. Only additive changes to expanded; never remove or rename keys.
   */
  toOldJSONMinified() {
    if (!this.media) {
      throw new Error(`[LibraryItem] Cannot convert to old JSON without media for library item "${this.id}"`)
    }

    return {
      id: this.id,
      ino: this.ino,
      oldLibraryItemId: this.extraData?.oldLibraryItemId || null,
      libraryId: this.libraryId,
      folderId: this.libraryFolderId,
      path: this.path,
      relPath: this.relPath,
      isFile: this.isFile,
      mtimeMs: this.mtime?.valueOf(),
      ctimeMs: this.ctime?.valueOf(),
      birthtimeMs: this.birthtime?.valueOf(),
      addedAt: this.createdAt.valueOf(),
      updatedAt: this.updatedAt.valueOf(),
      isMissing: !!this.isMissing,
      isInvalid: !!this.isInvalid,
      mediaType: this.mediaType,
      media: this.media.toOldJSONMinified(),
      numFiles: this.libraryFiles.length,
      size: this.size
    }
  }

  /**
   * Expanded library item JSON for item detail and socket events.
   * Must be a strict superset of `toOldJSONMinified()` — built by spreading minified, then adding expanded-only fields.
   */
  toOldJSONExpanded() {
    return {
      ...this.toOldJSONMinified(),
      lastScan: this.lastScan?.valueOf(),
      scanVersion: this.lastScanVersion,
      media: this.media.toOldJSONExpanded(this.id),
      // LibraryFile JSON includes a fileType property that may not be saved in libraryFiles column in the database
      libraryFiles: this.getLibraryFilesJson()
    }
  }
}

namespace LibraryItem {
  export type LibraryFileObject = ModelTypes.LibraryFileObject

  /**
   * Library item with its book (and its authors and series) loaded as media
   */
  export type BookLibraryItem = LibraryItem & { mediaType: 'book'; media: Book }

  /**
   * Library item with its podcast (and its episodes) loaded as media
   */
  export type PodcastLibraryItem = LibraryItem & { mediaType: 'podcast'; media: Podcast }

  /**
   * Library item with its media loaded; checking mediaType narrows media
   */
  export type LibraryItemExpanded = BookLibraryItem | PodcastLibraryItem
}

export = LibraryItem
