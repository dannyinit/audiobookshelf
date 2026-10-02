import Path = require('path')
import { Sequelize, Op, DataTypes, QueryTypes, Transaction, WhereOptions } from 'sequelize'

import packageJson = require('../package.json')
import fs = require('./libs/fsExtra')
import Logger = require('./Logger')

import dbMigration = require('./utils/migrations/dbMigration')
import Auth = require('./Auth')

import MigrationManager = require('./managers/MigrationManager')
import type ServerSettings = require('./objects/settings/ServerSettings')
import type NotificationSettings = require('./objects/settings/NotificationSettings')
import type EmailSettings = require('./objects/settings/EmailSettings')

interface NamedEntity {
  id: string
  name: string
}

/** Per-library cache of values used to populate the client's filter menus */
interface LibraryFilterData {
  authors: NamedEntity[]
  genres: string[]
  tags: string[]
  series: NamedEntity[]
  narrators: string[]
  languages: string[]
  publishers: string[]
  publishedDecades: string[]
  /** How many books returned from database query */
  bookCount: number
  /** How many authors returned from database query */
  authorCount: number
  /** How many series returned from database query */
  seriesCount: number
  /** How many podcasts returned from database query */
  podcastCount: number
  numIssues: number
  loadedAt: number
}

/** Model classes registered on the sequelize instance, keyed by modelName */
interface Models {
  user: typeof import('./models/User')
  session: typeof import('./models/Session')
  apiKey: typeof import('./models/ApiKey')
  library: typeof import('./models/Library')
  libraryFolder: typeof import('./models/LibraryFolder')
  book: typeof import('./models/Book')
  podcast: typeof import('./models/Podcast')
  podcastEpisode: typeof import('./models/PodcastEpisode')
  libraryItem: typeof import('./models/LibraryItem')
  mediaProgress: typeof import('./models/MediaProgress')
  series: typeof import('./models/Series')
  bookSeries: typeof import('./models/BookSeries')
  author: typeof import('./models/Author')
  bookAuthor: typeof import('./models/BookAuthor')
  collection: typeof import('./models/Collection')
  collectionBook: typeof import('./models/CollectionBook')
  playlist: typeof import('./models/Playlist')
  playlistMediaItem: typeof import('./models/PlaylistMediaItem')
  device: typeof import('./models/Device')
  playbackSession: typeof import('./models/PlaybackSession')
  feed: typeof import('./models/Feed')
  feedEpisode: typeof import('./models/FeedEpisode')
  setting: typeof import('./models/Setting')
  customMetadataProvider: typeof import('./models/CustomMetadataProvider')
  mediaItemShare: typeof import('./models/MediaItemShare')
}

class Database {
  sequelize: Sequelize | null
  dbPath: string | null
  /** New absdatabase.sqlite created */
  isNew: boolean
  /** Used to show initialization page in web ui */
  hasRootUser: boolean
  settings: Record<string, any>[]
  /** Cached library filter data */
  libraryFilterData: Record<string, LibraryFilterData>
  serverSettings!: ServerSettings
  notificationSettings!: NotificationSettings
  emailSettings!: EmailSettings
  supportsUnaccent: boolean
  supportsUnicodeFoldings: boolean

  constructor() {
    this.sequelize = null
    this.dbPath = null
    this.isNew = false // New absdatabase.sqlite created
    this.hasRootUser = false // Used to show initialization page in web ui

    this.settings = []

    // Cached library filter data
    this.libraryFilterData = {}

    this.supportsUnaccent = false
    this.supportsUnicodeFoldings = false
  }

  get models(): Models {
    return (this.sequelize?.models || {}) as unknown as Models
  }

  /** @type {typeof import('./models/User')} */
  get userModel(): typeof import('./models/User') {
    return this.models.user
  }

  /** @type {typeof import('./models/Session')} */
  get sessionModel(): typeof import('./models/Session') {
    return this.models.session
  }

  /** @type {typeof import('./models/ApiKey')} */
  get apiKeyModel(): typeof import('./models/ApiKey') {
    return this.models.apiKey
  }

  /** @type {typeof import('./models/Library')} */
  get libraryModel(): typeof import('./models/Library') {
    return this.models.library
  }

  /** @type {typeof import('./models/LibraryFolder')} */
  get libraryFolderModel(): typeof import('./models/LibraryFolder') {
    return this.models.libraryFolder
  }

  /** @type {typeof import('./models/Author')} */
  get authorModel(): typeof import('./models/Author') {
    return this.models.author
  }

  /** @type {typeof import('./models/Series')} */
  get seriesModel(): typeof import('./models/Series') {
    return this.models.series
  }

  /** @type {typeof import('./models/Book')} */
  get bookModel(): typeof import('./models/Book') {
    return this.models.book
  }

  /** @type {typeof import('./models/BookSeries')} */
  get bookSeriesModel(): typeof import('./models/BookSeries') {
    return this.models.bookSeries
  }

  /** @type {typeof import('./models/BookAuthor')} */
  get bookAuthorModel(): typeof import('./models/BookAuthor') {
    return this.models.bookAuthor
  }

  /** @type {typeof import('./models/Podcast')} */
  get podcastModel(): typeof import('./models/Podcast') {
    return this.models.podcast
  }

  /** @type {typeof import('./models/PodcastEpisode')} */
  get podcastEpisodeModel(): typeof import('./models/PodcastEpisode') {
    return this.models.podcastEpisode
  }

  /** @type {typeof import('./models/LibraryItem')} */
  get libraryItemModel(): typeof import('./models/LibraryItem') {
    return this.models.libraryItem
  }

  /** @type {typeof import('./models/MediaProgress')} */
  get mediaProgressModel(): typeof import('./models/MediaProgress') {
    return this.models.mediaProgress
  }

  /** @type {typeof import('./models/Collection')} */
  get collectionModel(): typeof import('./models/Collection') {
    return this.models.collection
  }

  /** @type {typeof import('./models/CollectionBook')} */
  get collectionBookModel(): typeof import('./models/CollectionBook') {
    return this.models.collectionBook
  }

  /** @type {typeof import('./models/Playlist')} */
  get playlistModel(): typeof import('./models/Playlist') {
    return this.models.playlist
  }

  /** @type {typeof import('./models/PlaylistMediaItem')} */
  get playlistMediaItemModel(): typeof import('./models/PlaylistMediaItem') {
    return this.models.playlistMediaItem
  }

  /** @type {typeof import('./models/Feed')} */
  get feedModel(): typeof import('./models/Feed') {
    return this.models.feed
  }

  /** @type {typeof import('./models/FeedEpisode')} */
  get feedEpisodeModel(): typeof import('./models/FeedEpisode') {
    return this.models.feedEpisode
  }

  /** @type {typeof import('./models/PlaybackSession')} */
  get playbackSessionModel(): typeof import('./models/PlaybackSession') {
    return this.models.playbackSession
  }

  /** @type {typeof import('./models/CustomMetadataProvider')} */
  get customMetadataProviderModel(): typeof import('./models/CustomMetadataProvider') {
    return this.models.customMetadataProvider
  }

  /** @type {typeof import('./models/MediaItemShare')} */
  get mediaItemShareModel(): typeof import('./models/MediaItemShare') {
    return this.models.mediaItemShare
  }

  /** @type {typeof import('./models/Device')} */
  get deviceModel(): typeof import('./models/Device') {
    return this.models.device
  }

  /**
   * Check if db file exists
   * @returns {boolean}
   */
  async checkHasDb(): Promise<boolean> {
    if (!(await fs.pathExists(this.dbPath))) {
      Logger.info(`[Database] absdatabase.sqlite not found at ${this.dbPath}`)
      return false
    }
    return true
  }

  /**
   * Connect to db, build models and run migrations
   * @param {boolean} [force=false] Used for testing, drops & re-creates all tables
   */
  async init(force: boolean = false) {
    this.dbPath = Path.join(global.ConfigPath, 'absdatabase.sqlite')

    // First check if this is a new database
    this.isNew = !(await this.checkHasDb()) || force

    if (!(await this.connect())) {
      throw new Error('Database connection failed')
    }

    try {
      const migrationManager = new MigrationManager(this.sequelize!, this.isNew, global.ConfigPath)
      await migrationManager.init(packageJson.version)
      await migrationManager.runMigrations()
    } catch (error) {
      Logger.error(`[Database] Failed to run migrations`, error)
      throw new Error('Database migration failed')
    }

    await this.buildModels(force)
    Logger.info(`[Database] Db initialized with models:`, Object.keys(this.sequelize!.models).join(', '))

    await this.addTriggers()

    await this.loadData()

    Logger.info(`[Database] running ANALYZE`)
    await this.sequelize!.query('ANALYZE')
    Logger.info(`[Database] ANALYZE completed`)
  }

  /**
   * Connect to db
   * @returns {boolean}
   */
  async connect(): Promise<boolean> {
    Logger.info(`[Database] Initializing db at "${this.dbPath}"`)

    let logging: false | ((sql: string, timing?: number) => void) = false
    let benchmark = false
    if (process.env.QUERY_LOGGING === 'log') {
      // Setting QUERY_LOGGING=log will log all Sequelize queries before they run
      Logger.info(`[Database] Query logging enabled`)
      logging = (query) => Logger.debug(`Running the following query:\n ${query}`)
    } else if (process.env.QUERY_LOGGING === 'benchmark') {
      // Setting QUERY_LOGGING=benchmark will log all Sequelize queries and their execution times, after they run
      Logger.info(`[Database] Query benchmarking enabled"`)
      logging = (query, time) => Logger.debug(`Ran the following query in ${time}ms:\n ${query}`)
      benchmark = true
    }

    this.sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: this.dbPath!,
      logging: logging,
      benchmark: benchmark,
      transactionType: Transaction.TYPES.IMMEDIATE
    })

    // Helper function
    this.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')

    try {
      await this.sequelize.authenticate()

      // Set SQLite pragmas from environment variables
      const allowedPragmas = [
        { name: 'mmap_size', env: 'SQLITE_MMAP_SIZE' },
        { name: 'cache_size', env: 'SQLITE_CACHE_SIZE' },
        { name: 'temp_store', env: 'SQLITE_TEMP_STORE' }
      ]

      for (const pragma of allowedPragmas) {
        const value = process.env[pragma.env]
        if (value !== undefined) {
          try {
            Logger.info(`[Database] Running "PRAGMA ${pragma.name} = ${value}"`)
            await this.sequelize.query(`PRAGMA ${pragma.name} = ${value}`)
            const [result] = await this.sequelize.query(`PRAGMA ${pragma.name}`)
            Logger.debug(`[Database] "PRAGMA ${pragma.name}" query result:`, result)
          } catch (error) {
            Logger.error(`[Database] Failed to set SQLite pragma ${pragma.name}`, error)
          }
        }
      }

      if (process.env.NUSQLITE3_PATH) {
        await this.loadExtension(process.env.NUSQLITE3_PATH)
        Logger.info(`[Database] Db supports unaccent and unicode foldings`)
        this.supportsUnaccent = true
        this.supportsUnicodeFoldings = true
      }
      Logger.info(`[Database] Db connection was successful`)
      return true
    } catch (error) {
      Logger.error(`[Database] Failed to connect to db`, error)
      return false
    }
  }

  /**
   * @param {string} extension paths to extension binary
   */
  async loadExtension(extension: string) {
    // This is a hack to get the db connection for loading extensions.
    // The proper way would be to use the 'afterConnect' hook, but that hook is never called for sqlite due to a bug in sequelize.
    // See https://github.com/sequelize/sequelize/issues/12487
    // This is not a public API and may break in the future.
    const db = await (this.sequelize as any).dialect.connectionManager.getConnection()
    if (typeof db?.loadExtension !== 'function') throw new Error('Failed to get db connection for loading extensions')

    Logger.info(`[Database] Loading extension ${extension}`)
    await new Promise<void>((resolve, reject) => {
      db.loadExtension(extension, (err: Error | null) => {
        if (err) {
          Logger.error(`[Database] Failed to load extension ${extension}`, err)
          reject(err)
          return
        }
        Logger.info(`[Database] Successfully loaded extension ${extension}`)
        resolve()
      })
    })
  }

  /**
   * Disconnect from db
   */
  async disconnect() {
    Logger.info(`[Database] Disconnecting sqlite db`)
    await this.sequelize?.close()
  }

  /**
   * Reconnect to db and init
   */
  async reconnect() {
    Logger.info(`[Database] Reconnecting sqlite db`)
    await this.init()
  }

  buildModels(force = false) {
    // Models are required lazily so module load order stays the same as before (they pull in utils that depend on Database)
    const models: { initModel(sequelize: Sequelize): void }[] = [
      require('./models/User'),
      require('./models/Session'),
      require('./models/ApiKey'),
      require('./models/Library'),
      require('./models/LibraryFolder'),
      require('./models/Book'),
      require('./models/Podcast'),
      require('./models/PodcastEpisode'),
      require('./models/LibraryItem'),
      require('./models/MediaProgress'),
      require('./models/Series'),
      require('./models/BookSeries'),
      require('./models/Author'),
      require('./models/BookAuthor'),
      require('./models/Collection'),
      require('./models/CollectionBook'),
      require('./models/Playlist'),
      require('./models/PlaylistMediaItem'),
      require('./models/Device'),
      require('./models/PlaybackSession'),
      require('./models/Feed'),
      require('./models/FeedEpisode'),
      require('./models/Setting'),
      require('./models/CustomMetadataProvider'),
      require('./models/MediaItemShare')
    ]
    for (const model of models) model.initModel(this.sequelize!)

    return this.sequelize!.sync({ force, alter: false })
  }

  /**
   * Compare two server versions
   * @param {string} v1
   * @param {string} v2
   * @returns {-1|0|1} 1 if v1 > v2
   */
  compareVersions(v1: string, v2: string): -1 | 0 | 1 {
    if (!v1 || !v2) return 0
    return <-1 | 0 | 1>v1.localeCompare(v2, undefined, { numeric: true, sensitivity: 'case', caseFirst: 'upper' })
  }

  /**
   * Checks if migration to sqlite db is necessary & runs migration.
   *
   * Check if version was upgraded and run any version specific migrations.
   *
   * Loads most of the data from the database. This is a temporary solution.
   */
  async loadData() {
    if (this.isNew && (await dbMigration.checkShouldMigrate())) {
      Logger.info(`[Database] New database was created and old database was detected - migrating old to new`)
      await dbMigration.migrate(this.models)
    }

    const settingsData = await this.models.setting.getOldSettings()
    this.settings = settingsData.settings
    this.emailSettings = settingsData.emailSettings
    this.serverSettings = settingsData.serverSettings
    this.notificationSettings = settingsData.notificationSettings
    global.ServerSettings = this.serverSettings.toJSON()

    // Version specific migrations
    if (packageJson.version !== this.serverSettings.version) {
      if (this.serverSettings.version === '2.3.0' && this.compareVersions(packageJson.version, '2.3.0') == 1) {
        await dbMigration.migrationPatch(this)
      }
      if (['2.3.0', '2.3.1', '2.3.2', '2.3.3'].includes(this.serverSettings.version!) && this.compareVersions(packageJson.version, '2.3.3') >= 0) {
        await dbMigration.migrationPatch2(this)
      }
    }
    // Build migrations
    if (this.serverSettings.buildNumber <= 0) {
      await require('./utils/migrations/absMetadataMigration').migrate(this)
    }

    await this.cleanDatabase()

    // Set if root user has been created
    this.hasRootUser = await this.models.user.getHasRootUser()

    // Update server settings with version/build
    let updateServerSettings = false
    if (packageJson.version !== this.serverSettings.version) {
      Logger.info(`[Database] Server upgrade detected from ${this.serverSettings.version} to ${packageJson.version}`)
      this.serverSettings.version = packageJson.version
      this.serverSettings.buildNumber = packageJson.buildNumber
      updateServerSettings = true
    } else if (packageJson.buildNumber !== this.serverSettings.buildNumber) {
      Logger.info(`[Database] Server v${packageJson.version} build upgraded from ${this.serverSettings.buildNumber} to ${packageJson.buildNumber}`)
      this.serverSettings.buildNumber = packageJson.buildNumber
      updateServerSettings = true
    }
    if (updateServerSettings) {
      await this.updateServerSettings()
    }
  }

  /**
   * Create root user
   * @param {string} username
   * @param {string} pash
   * @param {Auth} auth
   * @returns {Promise<boolean>} true if created
   */
  async createRootUser(username: string, pash: string, auth: Auth): Promise<boolean> {
    if (!this.sequelize) return false
    await this.userModel.createRootUser(username, pash, auth)
    this.hasRootUser = true
    return true
  }

  updateServerSettings() {
    if (!this.sequelize) return false
    global.ServerSettings = this.serverSettings.toJSON()
    return this.updateSetting(this.serverSettings)
  }

  updateSetting(settings: { toJSON(): Record<string, any> }) {
    if (!this.sequelize) return false
    return this.models.setting.updateSettingObj(settings.toJSON())
  }

  getPlaybackSessions(where: WhereOptions | null = null) {
    if (!this.sequelize) return false
    return this.models.playbackSession.getOldPlaybackSessions(where)
  }

  getPlaybackSession(sessionId: string) {
    if (!this.sequelize) return false
    return this.models.playbackSession.getById(sessionId)
  }

  createPlaybackSession(oldSession: import('./objects/PlaybackSession')) {
    if (!this.sequelize) return false
    return this.models.playbackSession.createFromOld(oldSession)
  }

  updatePlaybackSession(oldSession: import('./objects/PlaybackSession')) {
    if (!this.sequelize) return false
    return this.models.playbackSession.updateFromOld(oldSession)
  }

  removePlaybackSession(sessionId: string) {
    if (!this.sequelize) return false
    return this.models.playbackSession.removeById(sessionId)
  }

  replaceTagInFilterData(oldTag: string, newTag: string) {
    for (const libraryId in this.libraryFilterData) {
      const indexOf = this.libraryFilterData[libraryId].tags.findIndex((n) => n === oldTag)
      if (indexOf >= 0) {
        this.libraryFilterData[libraryId].tags.splice(indexOf, 1, newTag)
      }
    }
  }

  removeTagFromFilterData(tag: string) {
    for (const libraryId in this.libraryFilterData) {
      this.libraryFilterData[libraryId].tags = this.libraryFilterData[libraryId].tags.filter((t) => t !== tag)
    }
  }

  addTagsToFilterData(libraryId: string, tags: string[]) {
    if (!this.libraryFilterData[libraryId] || !tags?.length) return
    tags.forEach((t) => {
      if (!this.libraryFilterData[libraryId].tags.includes(t)) {
        this.libraryFilterData[libraryId].tags.push(t)
      }
    })
  }

  replaceGenreInFilterData(oldGenre: string, newGenre: string) {
    for (const libraryId in this.libraryFilterData) {
      const indexOf = this.libraryFilterData[libraryId].genres.findIndex((n) => n === oldGenre)
      if (indexOf >= 0) {
        this.libraryFilterData[libraryId].genres.splice(indexOf, 1, newGenre)
      }
    }
  }

  removeGenreFromFilterData(genre: string) {
    for (const libraryId in this.libraryFilterData) {
      this.libraryFilterData[libraryId].genres = this.libraryFilterData[libraryId].genres.filter((g) => g !== genre)
    }
  }

  addGenresToFilterData(libraryId: string, genres: string[]) {
    if (!this.libraryFilterData[libraryId] || !genres?.length) return
    genres.forEach((g) => {
      if (!this.libraryFilterData[libraryId].genres.includes(g)) {
        this.libraryFilterData[libraryId].genres.push(g)
      }
    })
  }

  replaceNarratorInFilterData(libraryId: string, oldNarrator: string, newNarrator: string) {
    if (!this.libraryFilterData[libraryId]) return
    const indexOf = this.libraryFilterData[libraryId].narrators.findIndex((n) => n === oldNarrator)
    if (indexOf >= 0) {
      this.libraryFilterData[libraryId].narrators.splice(indexOf, 1, newNarrator)
    }
  }

  removeNarratorFromFilterData(libraryId: string, narrator: string) {
    if (!this.libraryFilterData[libraryId]) return
    this.libraryFilterData[libraryId].narrators = this.libraryFilterData[libraryId].narrators.filter((n) => n !== narrator)
  }

  addNarratorsToFilterData(libraryId: string, narrators: string[]) {
    if (!this.libraryFilterData[libraryId] || !narrators?.length) return
    narrators.forEach((n) => {
      if (!this.libraryFilterData[libraryId].narrators.includes(n)) {
        this.libraryFilterData[libraryId].narrators.push(n)
      }
    })
  }

  removeSeriesFromFilterData(libraryId: string, seriesId: string) {
    if (!this.libraryFilterData[libraryId]) return
    this.libraryFilterData[libraryId].series = this.libraryFilterData[libraryId].series.filter((se) => se.id !== seriesId)
  }

  addSeriesToFilterData(libraryId: string, seriesName: string, seriesId: string) {
    if (!this.libraryFilterData[libraryId]) return
    // Check if series is already added
    if (this.libraryFilterData[libraryId].series.some((se) => se.id === seriesId)) return
    this.libraryFilterData[libraryId].series.push({
      id: seriesId,
      name: seriesName
    })
  }

  removeAuthorFromFilterData(libraryId: string, authorId: string) {
    if (!this.libraryFilterData[libraryId]) return
    this.libraryFilterData[libraryId].authors = this.libraryFilterData[libraryId].authors.filter((au) => au.id !== authorId)
  }

  addAuthorToFilterData(libraryId: string, authorName: string, authorId: string) {
    if (!this.libraryFilterData[libraryId]) return
    // Check if author is already added
    if (this.libraryFilterData[libraryId].authors.some((au) => au.id === authorId)) return
    this.libraryFilterData[libraryId].authors.push({
      id: authorId,
      name: authorName
    })
  }

  addPublisherToFilterData(libraryId: string, publisher: string) {
    if (!this.libraryFilterData[libraryId] || !publisher || this.libraryFilterData[libraryId].publishers.includes(publisher)) return
    this.libraryFilterData[libraryId].publishers.push(publisher)
  }

  addPublishedDecadeToFilterData(libraryId: string, decade: string) {
    if (!this.libraryFilterData[libraryId] || !decade || this.libraryFilterData[libraryId].publishedDecades.includes(decade)) return
    this.libraryFilterData[libraryId].publishedDecades.push(decade)
  }

  addLanguageToFilterData(libraryId: string, language: string) {
    if (!this.libraryFilterData[libraryId] || !language || this.libraryFilterData[libraryId].languages.includes(language)) return
    this.libraryFilterData[libraryId].languages.push(language)
  }

  /**
   * Used when updating items to make sure author id exists
   * If library filter data is set then use that for check
   * otherwise lookup in db
   * @param {string} libraryId
   * @param {string} authorId
   * @returns {Promise<boolean>}
   */
  async checkAuthorExists(libraryId: string, authorId: string): Promise<boolean> {
    if (!this.libraryFilterData[libraryId]) {
      return this.authorModel.checkExistsById(authorId)
    }
    return this.libraryFilterData[libraryId].authors.some((au) => au.id === authorId)
  }

  /**
   * Used when updating items to make sure series id exists
   * If library filter data is set then use that for check
   * otherwise lookup in db
   * @param {string} libraryId
   * @param {string} seriesId
   * @returns {Promise<boolean>}
   */
  async checkSeriesExists(libraryId: string, seriesId: string): Promise<boolean> {
    if (!this.libraryFilterData[libraryId]) {
      return this.seriesModel.checkExistsById(seriesId)
    }
    return this.libraryFilterData[libraryId].series.some((se) => se.id === seriesId)
  }

  /**
   * Get author id for library by name. Uses library filter data if available
   *
   * @param {string} libraryId
   * @param {string} authorName
   * @returns {Promise<string>} author id or null if not found
   */
  async getAuthorIdByName(libraryId: string, authorName: string): Promise<string | null> {
    if (!this.libraryFilterData[libraryId]) {
      return (await this.authorModel.getByNameAndLibrary(authorName, libraryId))?.id || null
    }
    return this.libraryFilterData[libraryId].authors.find((au) => au.name === authorName)?.id || null
  }

  /**
   * Get series id for library by name. Uses library filter data if available
   *
   * @param {string} libraryId
   * @param {string} seriesName
   * @returns {Promise<string>} series id or null if not found
   */
  async getSeriesIdByName(libraryId: string, seriesName: string): Promise<string | null> {
    if (!this.libraryFilterData[libraryId]) {
      return (await this.seriesModel.getByNameAndLibrary(seriesName, libraryId))?.id || null
    }
    return this.libraryFilterData[libraryId].series.find((se) => se.name === seriesName)?.id || null
  }

  /**
   * Reset numIssues for library
   * @param {string} libraryId
   */
  async resetLibraryIssuesFilterData(libraryId: string) {
    if (!this.libraryFilterData[libraryId]) return // Do nothing if filter data is not set

    this.libraryFilterData[libraryId].numIssues = await this.libraryItemModel.count({
      where: {
        libraryId,
        [Op.or]: [
          {
            isMissing: true
          },
          {
            isInvalid: true
          }
        ]
      }
    })
  }

  /**
   * Clean invalid records in database
   * Series should have atleast one Book
   * Book and Podcast must have an associated LibraryItem (and vice versa)
   * Remove playback sessions that are 3 seconds or less
   * Remove duplicate mediaProgresses
   * Remove expired auth sessions
   * Deactivate expired api keys
   */
  async cleanDatabase() {
    // Remove invalid Podcast records
    const podcastsWithNoLibraryItem = await this.podcastModel.findAll({
      include: {
        model: this.libraryItemModel,
        required: false
      },
      where: { '$libraryItem.id$': null }
    })
    for (const podcast of podcastsWithNoLibraryItem) {
      Logger.warn(`Found podcast "${podcast.title}" with no libraryItem - removing it`)
      await podcast.destroy()
    }

    // Remove invalid Book records
    const booksWithNoLibraryItem = await this.bookModel.findAll({
      include: {
        model: this.libraryItemModel,
        required: false
      },
      where: { '$libraryItem.id$': null }
    })
    for (const book of booksWithNoLibraryItem) {
      Logger.warn(`Found book "${book.title}" with no libraryItem - removing it`)
      await book.destroy()
    }

    // Remove invalid LibraryItem records
    const libraryItemsWithNoMedia = await this.libraryItemModel.findAll({
      include: [
        {
          model: this.bookModel,
          attributes: ['id']
        },
        {
          model: this.podcastModel,
          attributes: ['id']
        }
      ],
      where: {
        '$book.id$': null,
        '$podcast.id$': null
      }
    })
    for (const libraryItem of libraryItemsWithNoMedia) {
      Logger.warn(`Found libraryItem "${libraryItem.id}" with no media - removing it`)
      await libraryItem.destroy()
    }

    // Remove invalid PlaylistMediaItem records
    const playlistMediaItemsWithNoMediaItem = await this.playlistMediaItemModel.findAll({
      include: [
        {
          model: this.bookModel,
          attributes: ['id']
        },
        {
          model: this.podcastEpisodeModel,
          attributes: ['id']
        }
      ],
      where: {
        '$book.id$': null,
        '$podcastEpisode.id$': null
      }
    })
    for (const playlistMediaItem of playlistMediaItemsWithNoMediaItem) {
      Logger.warn(`Found playlistMediaItem with no book or podcastEpisode - removing it`)
      await playlistMediaItem.destroy()
    }

    // Remove invalid CollectionBook records
    const collectionBooksWithNoBook = await this.collectionBookModel.findAll({
      include: {
        model: this.bookModel,
        required: false
      },
      where: { '$book.id$': null }
    })
    for (const collectionBook of collectionBooksWithNoBook) {
      Logger.warn(`Found collectionBook with no book - removing it`)
      await collectionBook.destroy()
    }

    // Remove empty series
    const emptySeries = await this.seriesModel.findAll({
      include: {
        model: this.bookSeriesModel,
        required: false
      },
      where: { '$bookSeries.id$': null }
    })
    for (const series of emptySeries) {
      Logger.warn(`Found series "${series.name}" with no books - removing it`)
      await series.destroy()
    }

    // Remove playback sessions that were 3 seconds or less
    const badSessionsRemoved = await this.playbackSessionModel.destroy({
      where: {
        timeListening: {
          [Op.lte]: 3
        }
      }
    })
    if (badSessionsRemoved > 0) {
      Logger.warn(`Removed ${badSessionsRemoved} sessions that were 3 seconds or less`)
    }

    // Remove mediaProgresses with duplicate mediaItemId (remove the oldest updatedAt or if updatedAt is the same, remove arbitrary one)
    const duplicateMediaProgresses = await this.sequelize!.query<{ id: string; mediaItemId: string }>(`SELECT mp1.id, mp1.mediaItemId
FROM mediaProgresses mp1
WHERE EXISTS (
    SELECT 1
    FROM mediaProgresses mp2
    WHERE mp2.mediaItemId = mp1.mediaItemId
    AND mp2.userId = mp1.userId
    AND (
        mp2.updatedAt > mp1.updatedAt
        OR (mp2.updatedAt = mp1.updatedAt AND mp2.id < mp1.id)
    )
)`,
      { type: QueryTypes.SELECT }
    )
    for (const duplicateMediaProgress of duplicateMediaProgresses) {
      Logger.warn(`Found duplicate mediaProgress for mediaItem "${duplicateMediaProgress.mediaItemId}" - removing it`)
      await this.mediaProgressModel.destroy({
        where: { id: duplicateMediaProgress.id }
      })
    }

    // Remove expired Session records
    await this.cleanupExpiredSessions()

    // Deactivate expired api keys
    await this.deactivateExpiredApiKeys()
  }

  /**
   * Deactivate expired api keys
   */
  async deactivateExpiredApiKeys() {
    try {
      const affectedCount = await this.apiKeyModel.deactivateExpiredApiKeys()
      if (affectedCount > 0) {
        Logger.info(`[Database] Deactivated ${affectedCount} expired api keys`)
      }
    } catch (error) {
      Logger.error(`[Database] Error deactivating expired api keys: ${(error as Error).message}`)
    }
  }

  /**
   * Clean up expired sessions from the database
   */
  async cleanupExpiredSessions() {
    try {
      const deletedCount = await this.sessionModel.cleanupExpiredSessions()
      if (deletedCount > 0) {
        Logger.info(`[Database] Cleaned up ${deletedCount} expired sessions`)
      }
    } catch (error) {
      Logger.error(`[Database] Error cleaning up expired sessions: ${(error as Error).message}`)
    }
  }

  async createTextSearchQuery(query: string) {
    const textQuery = new this.TextSearchQuery(this.sequelize!, this.supportsUnaccent, query)
    await textQuery.init()
    return textQuery
  }

  /**
   * This is used to create necessary triggers for new databases.
   * It adds triggers to update libraryItems.title[IgnorePrefix] when (books|podcasts).title[IgnorePrefix] is updated
   */
  async addTriggers() {
    await this.addTriggerIfNotExists('books', 'title', 'id', 'libraryItems', 'title', 'mediaId')
    await this.addTriggerIfNotExists('books', 'titleIgnorePrefix', 'id', 'libraryItems', 'titleIgnorePrefix', 'mediaId')
    await this.addTriggerIfNotExists('podcasts', 'title', 'id', 'libraryItems', 'title', 'mediaId')
    await this.addTriggerIfNotExists('podcasts', 'titleIgnorePrefix', 'id', 'libraryItems', 'titleIgnorePrefix', 'mediaId')
    await this.addAuthorNamesTriggersIfNotExist()
  }

  async addTriggerIfNotExists(sourceTable: string, sourceColumn: string, sourceIdColumn: string, targetTable: string, targetColumn: string, targetIdColumn: string) {
    const action = `update_${targetTable}_${targetColumn}`
    const fromSource = sourceTable === 'books' ? '' : `_from_${sourceTable}_${sourceColumn}`
    const triggerName = this.convertToSnakeCase(`${action}${fromSource}`)

    const [{ count }] = await this.sequelize!.query<{ count: number }>(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='trigger' AND name='${triggerName}'`, { type: QueryTypes.SELECT })
    if (count > 0) return // Trigger already exists

    Logger.info(`[Database] Adding trigger ${triggerName}`)

    await this.sequelize!.query(`
      CREATE TRIGGER ${triggerName}
        AFTER UPDATE OF ${sourceColumn} ON ${sourceTable}
        FOR EACH ROW
        BEGIN
          UPDATE ${targetTable}
            SET ${targetColumn} = NEW.${sourceColumn}
          WHERE ${targetTable}.${targetIdColumn} = NEW.${sourceIdColumn};
        END;
    `)
  }

  async addAuthorNamesTriggersIfNotExist() {
    const libraryItems = 'libraryItems'
    const bookAuthors = 'bookAuthors'
    const authors = 'authors'
    const columns = [
      { name: 'authorNamesFirstLast', source: `${authors}.name`, spec: { type: DataTypes.STRING, allowNull: true } },
      { name: 'authorNamesLastFirst', source: `${authors}.lastFirst`, spec: { type: DataTypes.STRING, allowNull: true } }
    ]
    const authorsSort = `${bookAuthors}.createdAt ASC`
    const columnNames = columns.map((column) => column.name).join(', ')
    const columnSourcesExpression = columns.map((column) => `GROUP_CONCAT(${column.source}, ', ' ORDER BY ${authorsSort})`).join(', ')
    const authorsJoin = `${authors} JOIN ${bookAuthors} ON ${authors}.id = ${bookAuthors}.authorId`

    const addBookAuthorsTriggerIfNotExists = async (action: 'insert' | 'delete') => {
      const modifiedRecord = action === 'delete' ? 'OLD' : 'NEW'
      const triggerName = this.convertToSnakeCase(`update_${libraryItems}_authorNames_on_${bookAuthors}_${action}`)
      const authorNamesSubQuery = `
        SELECT ${columnSourcesExpression}
        FROM ${authorsJoin}
        WHERE ${bookAuthors}.bookId = ${modifiedRecord}.bookId
      `
      const [{ count }] = await this.sequelize!.query<{ count: number }>(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='trigger' AND name='${triggerName}'`, { type: QueryTypes.SELECT })
      if (count > 0) return // Trigger already exists

      Logger.info(`[Database] Adding trigger ${triggerName}`)

      await this.sequelize!.query(`
        CREATE TRIGGER ${triggerName}
          AFTER ${action} ON ${bookAuthors}
          FOR EACH ROW
          BEGIN
            UPDATE ${libraryItems}
              SET (${columnNames}) = (${authorNamesSubQuery})
            WHERE mediaId = ${modifiedRecord}.bookId;
          END;
      `)
    }

    const addAuthorsUpdateTriggerIfNotExists = async () => {
      const triggerName = this.convertToSnakeCase(`update_${libraryItems}_authorNames_on_authors_update`)
      const authorNamesSubQuery = `
        SELECT ${columnSourcesExpression}
        FROM ${authorsJoin}
        WHERE ${bookAuthors}.bookId = ${libraryItems}.mediaId
      `

      const [{ count }] = await this.sequelize!.query<{ count: number }>(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='trigger' AND name='${triggerName}'`, { type: QueryTypes.SELECT })
      if (count > 0) return // Trigger already exists

      Logger.info(`[Database] Adding trigger ${triggerName}`)

      await this.sequelize!.query(`
        CREATE TRIGGER ${triggerName}
          AFTER UPDATE OF name ON ${authors}
          FOR EACH ROW
          BEGIN
            UPDATE ${libraryItems}
              SET (${columnNames}) = (${authorNamesSubQuery})
            WHERE mediaId IN (SELECT bookId FROM ${bookAuthors} WHERE authorId = NEW.id);
        END;
      `)
    }

    await addBookAuthorsTriggerIfNotExists('insert')
    await addBookAuthorsTriggerIfNotExists('delete')
    await addAuthorsUpdateTriggerIfNotExists()
  }

  convertToSnakeCase(str: string) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase()
  }

  TextSearchQuery = class {
    sequelize: Sequelize
    supportsUnaccent: boolean
    query: string
    hasAccents: boolean

    constructor(sequelize: Sequelize, supportsUnaccent: boolean, query: string) {
      this.sequelize = sequelize
      this.supportsUnaccent = supportsUnaccent
      this.query = query
      this.hasAccents = false
    }

    /**
     * Returns a normalized (accents-removed) expression for the specified value.
     *
     * @param {string} value
     * @returns {string}
     */
    normalize(value: string): string {
      return `unaccent(${value})`
    }

    /**
     * Initialize the text query.
     *
     */
    async init() {
      if (!this.supportsUnaccent) return
      const escapedQuery = this.sequelize.escape(this.query)
      const normalizedQueryExpression = this.normalize(escapedQuery)
      const normalizedQueryResult = await this.sequelize.query<{ normalized_query: string }>(`SELECT ${normalizedQueryExpression} as normalized_query`, { type: QueryTypes.SELECT })
      const normalizedQuery = normalizedQueryResult[0].normalized_query
      this.hasAccents = escapedQuery !== this.sequelize.escape(normalizedQuery)
    }

    /**
     * Get match expression for the specified column.
     * If the query contains accents, match against the column as-is (case-insensitive exact match).
     * otherwise match against a normalized column (case-insensitive match with accents removed).
     *
     * @param {string} column
     * @returns {string}
     */
    matchExpression(column: string): string {
      const pattern = this.sequelize.escape(`%${this.query}%`)
      if (!this.supportsUnaccent) return `${column} LIKE ${pattern}`
      const normalizedColumn = this.hasAccents ? column : this.normalize(column)
      return `${normalizedColumn} LIKE ${pattern}`
    }
  }
}

const database = new Database()
namespace database {
  export type LibraryFilterDataObject = LibraryFilterData
}

export = database
