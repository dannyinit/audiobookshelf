import Path = require('path')
import Sequelize = require('sequelize')
import type { Attributes, BelongsToGetAssociationMixin, CreationAttributes, CreationOptional, FindOptions, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute, Transaction } from 'sequelize'
import Logger = require('../Logger')
import RSS = require('../libs/rss')
import type Book = require('./Book')
import type Collection = require('./Collection')
import type FeedEpisode = require('./FeedEpisode')
import type LibraryItem = require('./LibraryItem')
import type Playlist = require('./Playlist')
import type Podcast = require('./Podcast')
import type Series = require('./Series')
import type { ModelsSequelize } from './types'
const { DataTypes, Model } = Sequelize

interface FeedOptionsObject {
  preventIndexing: boolean
  ownerName: string | null
  ownerEmail: string | null
}

/**
 * Feed attributes built from the entity the feed is for (see getFeedObjForLibraryItem)
 */
type FeedObject = CreationAttributes<Feed>

/**
 * Custom element of the vendored rss library: element name to content
 */
type RssCustomElement = Record<string, unknown>

/**
 * Creates the feed episodes for the entity of a feed (see FeedEpisode createFromPodcastEpisodes, createFromAudiobookTracks, createFromBooks)
 */
type FeedEpisodeCreateFunc = (entity: LibraryItem.LibraryItemExpanded | Book.BookExpandedWithLibraryItem[], feed: Feed, slug: string, transaction: Transaction) => Promise<FeedEpisode[]>

/**
 * dataValues of a loaded feed with the included entity (moved to entity by the afterFind hook)
 */
type FeedDataValues = InferAttributes<Feed> & {
  libraryItem?: LibraryItem
  collection?: Collection
  series?: Series
  playlist?: Playlist
  entity?: LibraryItem | Collection | Series | Playlist
}

class Feed extends Model<InferAttributes<Feed>, InferCreationAttributes<Feed>> {
  declare id: CreationOptional<string>
  declare slug: string
  declare entityType: string
  declare entityId: string
  declare entityUpdatedAt: Date
  declare serverAddress: string
  declare feedURL: string
  declare imageURL: string
  declare siteURL: string
  declare title: string | null
  declare description: string | null
  declare author: string | null
  declare podcastType: string | null
  declare language: CreationOptional<string | null>
  declare ownerName: CreationOptional<string | null>
  declare ownerEmail: CreationOptional<string | null>
  declare explicit: boolean
  declare preventIndexing: CreationOptional<boolean | null>
  declare coverPath: string | null
  declare userId: string
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize
  declare static readonly sequelize: ModelsSequelize

  // Expanded properties

  /** only set if expanded */
  declare feedEpisodes: NonAttribute<FeedEpisode[]>

  /** Set by the afterFind hook when the entity is included */
  declare entity?: NonAttribute<LibraryItem | Collection | Series | Playlist>

  // Associations, only set when included (the afterFind hook moves them to entity and deletes them)

  declare libraryItem?: NonAttribute<LibraryItem>
  declare collection?: NonAttribute<Collection>
  declare series?: NonAttribute<Series>
  declare playlist?: NonAttribute<Playlist>

  declare getLibraryItem: BelongsToGetAssociationMixin<LibraryItem>
  declare getCollection: BelongsToGetAssociationMixin<Collection>
  declare getSeries: BelongsToGetAssociationMixin<Series>
  declare getPlaylist: BelongsToGetAssociationMixin<Playlist>

  /**
   * @returns true if feed was removed
   */
  static async removeById(feedId: string): Promise<boolean> {
    return (
      (await this.destroy({
        where: {
          id: feedId
        }
      })) > 0
    )
  }

  /**
   * @param [feedOptions=null]
   */
  static getFeedObjForLibraryItem(userId: string, libraryItem: LibraryItem.LibraryItemExpanded, slug: string, serverAddress: string, feedOptions: FeedOptionsObject | null = null): FeedObject {
    const media = libraryItem.media

    let entityUpdatedAt = libraryItem.updatedAt

    // Podcast feeds should use the most recent episode updatedAt if more recent
    if (libraryItem.mediaType === 'podcast') {
      entityUpdatedAt = libraryItem.media.podcastEpisodes.reduce((mostRecent, episode) => {
        return episode.updatedAt > mostRecent ? episode.updatedAt : mostRecent
      }, entityUpdatedAt)
    } else if (libraryItem.media.updatedAt > entityUpdatedAt) {
      // Book feeds will use Book.updatedAt if more recent
      entityUpdatedAt = libraryItem.media.updatedAt
    }

    const feedObj: FeedObject = {
      slug,
      entityType: 'libraryItem',
      entityId: libraryItem.id,
      entityUpdatedAt,
      serverAddress,
      feedURL: `/feed/${slug}`,
      imageURL: media.coverPath ? `/feed/${slug}/cover${Path.extname(media.coverPath)}` : `/Logo.png`,
      siteURL: `/item/${libraryItem.id}`,
      title: media.title,
      description: media.description,
      // cast(d) (2): media is a Podcast when mediaType is "podcast" and a Book otherwise
      author: libraryItem.mediaType === 'podcast' ? (media as Podcast).author : (media as Book).authorName,
      // cast(d): media is a Podcast when mediaType is "podcast"
      podcastType: libraryItem.mediaType === 'podcast' ? (media as Podcast).podcastType : 'serial',
      language: media.language,
      explicit: media.explicit,
      coverPath: media.coverPath,
      userId
    }

    if (feedOptions) {
      feedObj.preventIndexing = feedOptions.preventIndexing
      feedObj.ownerName = feedOptions.ownerName
      feedObj.ownerEmail = feedOptions.ownerEmail
    }

    return feedObj
  }

  static async createFeedForLibraryItem(userId: string, libraryItem: LibraryItem.LibraryItemExpanded, slug: string, serverAddress: string, feedOptions: FeedOptionsObject): Promise<Feed | null> {
    const feedObj = this.getFeedObjForLibraryItem(userId, libraryItem, slug, serverAddress, feedOptions)

    const feedEpisodeModel = this.sequelize.models.feedEpisode

    const transaction = await this.sequelize.transaction()
    try {
      const feed = await this.create(feedObj, { transaction })

      if (libraryItem.mediaType === 'podcast') {
        feed.feedEpisodes = await feedEpisodeModel.createFromPodcastEpisodes(libraryItem, feed, slug, transaction)
      } else {
        feed.feedEpisodes = await feedEpisodeModel.createFromAudiobookTracks(libraryItem, feed, slug, transaction)
      }

      await transaction.commit()

      return feed
    } catch (error) {
      Logger.error(`[Feed] Error creating feed for library item ${libraryItem.id}`, error)
      await transaction.rollback()
      return null
    }
  }

  /**
   * @param collectionExpanded collection with its books expanded (with their libraryItem)
   * @param [feedOptions=null]
   */
  static getFeedObjForCollection(userId: string, collectionExpanded: Collection, slug: string, serverAddress: string, feedOptions: FeedOptionsObject | null = null): { feedObj: FeedObject; booksWithTracks: Book.BookExpandedWithLibraryItem[] } {
    const booksWithTracks = collectionExpanded.books.filter((book) => book.includedAudioFiles.length)

    const entityUpdatedAt = booksWithTracks.reduce((mostRecent, book) => {
      const updatedAt = book.libraryItem.updatedAt > book.updatedAt ? book.libraryItem.updatedAt : book.updatedAt
      return updatedAt > mostRecent ? updatedAt : mostRecent
    }, collectionExpanded.updatedAt)

    const firstBookWithCover = booksWithTracks.find((book) => book.coverPath)

    const allBookAuthorNames = booksWithTracks.reduce<string[]>((authorNames, book) => {
      const bookAuthorsToAdd = book.authors.filter((author) => !authorNames.includes(author.name)).map((author) => author.name)
      return authorNames.concat(bookAuthorsToAdd)
    }, [])
    let author = allBookAuthorNames.slice(0, 3).join(', ')
    if (allBookAuthorNames.length > 3) {
      author += ' & more'
    }

    const feedObj: FeedObject = {
      slug,
      entityType: 'collection',
      entityId: collectionExpanded.id,
      entityUpdatedAt,
      serverAddress,
      feedURL: `/feed/${slug}`,
      imageURL: firstBookWithCover?.coverPath ? `/feed/${slug}/cover${Path.extname(firstBookWithCover.coverPath)}` : `/Logo.png`,
      siteURL: `/collection/${collectionExpanded.id}`,
      title: collectionExpanded.name,
      description: collectionExpanded.description || '',
      author,
      podcastType: 'serial',
      explicit: booksWithTracks.some((book) => book.explicit), // If any book is explicit, the feed is explicit
      coverPath: firstBookWithCover?.coverPath || null,
      userId
    }

    if (feedOptions) {
      feedObj.preventIndexing = feedOptions.preventIndexing
      feedObj.ownerName = feedOptions.ownerName
      feedObj.ownerEmail = feedOptions.ownerEmail
    }

    return {
      feedObj,
      booksWithTracks
    }
  }

  /**
   * @param collectionExpanded collection with its books expanded (with their libraryItem)
   */
  static async createFeedForCollection(userId: string, collectionExpanded: Collection, slug: string, serverAddress: string, feedOptions: FeedOptionsObject): Promise<Feed | null> {
    const { feedObj, booksWithTracks } = this.getFeedObjForCollection(userId, collectionExpanded, slug, serverAddress, feedOptions)

    const feedEpisodeModel = this.sequelize.models.feedEpisode

    const transaction = await this.sequelize.transaction()
    try {
      const feed = await this.create(feedObj, { transaction })
      feed.feedEpisodes = await feedEpisodeModel.createFromBooks(booksWithTracks, feed, slug, transaction)

      await transaction.commit()

      return feed
    } catch (error) {
      Logger.error(`[Feed] Error creating feed for collection ${collectionExpanded.id}`, error)
      await transaction.rollback()
      return null
    }
  }

  /**
   * @param seriesExpanded series with its books expanded (with their libraryItem)
   * @param [feedOptions=null]
   */
  static getFeedObjForSeries(userId: string, seriesExpanded: Series, slug: string, serverAddress: string, feedOptions: FeedOptionsObject | null = null): { feedObj: FeedObject; booksWithTracks: Book.BookExpandedWithLibraryItem[] } {
    const booksWithTracks = seriesExpanded.books.filter((book) => book.includedAudioFiles.length)
    const entityUpdatedAt = booksWithTracks.reduce((mostRecent, book) => {
      const updatedAt = book.libraryItem.updatedAt > book.updatedAt ? book.libraryItem.updatedAt : book.updatedAt
      return updatedAt > mostRecent ? updatedAt : mostRecent
    }, seriesExpanded.updatedAt)

    const firstBookWithCover = booksWithTracks.find((book) => book.coverPath)

    const allBookAuthorNames = booksWithTracks.reduce<string[]>((authorNames, book) => {
      const bookAuthorsToAdd = book.authors.filter((author) => !authorNames.includes(author.name)).map((author) => author.name)
      return authorNames.concat(bookAuthorsToAdd)
    }, [])
    let author = allBookAuthorNames.slice(0, 3).join(', ')
    if (allBookAuthorNames.length > 3) {
      author += ' & more'
    }

    const feedObj: FeedObject = {
      slug,
      entityType: 'series',
      entityId: seriesExpanded.id,
      entityUpdatedAt,
      serverAddress,
      feedURL: `/feed/${slug}`,
      imageURL: firstBookWithCover?.coverPath ? `/feed/${slug}/cover${Path.extname(firstBookWithCover.coverPath)}` : `/Logo.png`,
      siteURL: `/library/${booksWithTracks[0].libraryItem.libraryId}/series/${seriesExpanded.id}`,
      title: seriesExpanded.name,
      description: seriesExpanded.description || '',
      author,
      podcastType: 'serial',
      explicit: booksWithTracks.some((book) => book.explicit), // If any book is explicit, the feed is explicit
      coverPath: firstBookWithCover?.coverPath || null,
      userId
    }

    if (feedOptions) {
      feedObj.preventIndexing = feedOptions.preventIndexing
      feedObj.ownerName = feedOptions.ownerName
      feedObj.ownerEmail = feedOptions.ownerEmail
    }

    return {
      feedObj,
      booksWithTracks
    }
  }

  /**
   * @param seriesExpanded series with its books expanded (with their libraryItem)
   */
  static async createFeedForSeries(userId: string, seriesExpanded: Series, slug: string, serverAddress: string, feedOptions: FeedOptionsObject): Promise<Feed | null> {
    const { feedObj, booksWithTracks } = this.getFeedObjForSeries(userId, seriesExpanded, slug, serverAddress, feedOptions)

    const feedEpisodeModel = this.sequelize.models.feedEpisode

    const transaction = await this.sequelize.transaction()
    try {
      const feed = await this.create(feedObj, { transaction })
      feed.feedEpisodes = await feedEpisodeModel.createFromBooks(booksWithTracks, feed, slug, transaction)

      await transaction.commit()

      return feed
    } catch (error) {
      Logger.error(`[Feed] Error creating feed for series ${seriesExpanded.id}`, error)
      await transaction.rollback()
      return null
    }
  }

  /**
   * Initialize model
   *
   * Polymorphic association: Feeds can be created from LibraryItem, Collection, Playlist or Series
   * @see https://sequelize.org/docs/v6/advanced-association-concepts/polymorphic-associations/
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
        slug: DataTypes.STRING,
        entityType: DataTypes.STRING,
        entityId: DataTypes.UUID,
        entityUpdatedAt: DataTypes.DATE,
        serverAddress: DataTypes.STRING,
        feedURL: DataTypes.STRING,
        imageURL: DataTypes.STRING,
        siteURL: DataTypes.STRING,
        title: DataTypes.STRING,
        description: DataTypes.TEXT,
        author: DataTypes.STRING,
        podcastType: DataTypes.STRING,
        language: DataTypes.STRING,
        ownerName: DataTypes.STRING,
        ownerEmail: DataTypes.STRING,
        explicit: DataTypes.BOOLEAN,
        preventIndexing: DataTypes.BOOLEAN,
        coverPath: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'feed'
      }
    )

    const { user, libraryItem, collection, series, playlist } = sequelize.models

    user.hasMany(Feed)
    Feed.belongsTo(user)

    libraryItem.hasMany(Feed, {
      foreignKey: 'entityId',
      constraints: false,
      scope: {
        entityType: 'libraryItem'
      }
    })
    Feed.belongsTo(libraryItem, { foreignKey: 'entityId', constraints: false })

    collection.hasMany(Feed, {
      foreignKey: 'entityId',
      constraints: false,
      scope: {
        entityType: 'collection'
      }
    })
    Feed.belongsTo(collection, { foreignKey: 'entityId', constraints: false })

    series.hasMany(Feed, {
      foreignKey: 'entityId',
      constraints: false,
      scope: {
        entityType: 'series'
      }
    })
    Feed.belongsTo(series, { foreignKey: 'entityId', constraints: false })

    playlist.hasMany(Feed, {
      foreignKey: 'entityId',
      constraints: false,
      scope: {
        entityType: 'playlist'
      }
    })
    Feed.belongsTo(playlist, { foreignKey: 'entityId', constraints: false })

    Feed.addHook('afterFind', (findResult: Feed[] | Feed | null) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]
      for (const instance of findResult) {
        // Same object as instance.dataValues, typed with the included rows
        const dataValues: FeedDataValues = instance.dataValues
        if (instance.entityType === 'libraryItem' && instance.libraryItem !== undefined) {
          instance.entity = instance.libraryItem
          dataValues.entity = dataValues.libraryItem
        } else if (instance.entityType === 'collection' && instance.collection !== undefined) {
          instance.entity = instance.collection
          dataValues.entity = dataValues.collection
        } else if (instance.entityType === 'series' && instance.series !== undefined) {
          instance.entity = instance.series
          dataValues.entity = dataValues.series
        } else if (instance.entityType === 'playlist' && instance.playlist !== undefined) {
          instance.entity = instance.playlist
          dataValues.entity = dataValues.playlist
        }

        // To prevent mistakes:
        delete instance.libraryItem
        delete dataValues.libraryItem
        delete instance.collection
        delete dataValues.collection
        delete instance.series
        delete dataValues.series
        delete instance.playlist
        delete dataValues.playlist
      }
    })
  }

  async updateFeedForEntity(): Promise<Feed | null> {
    const feedEpisodeModel = this.sequelize.models.feedEpisode

    let feedObj: FeedObject | null = null
    let feedEpisodeCreateFunc = null
    let feedEpisodeCreateFuncEntity = null

    if (this.entityType === 'libraryItem') {
      const libraryItemModel = this.sequelize.models.libraryItem

      const itemExpanded = await libraryItemModel.getExpandedById(this.entityId)
      // NOTE: itemExpanded is null when the library item no longer exists (or has no media), then getFeedObjForLibraryItem throws a TypeError outside the try below
      // cast(c): itemExpanded may be null (see NOTE above); passed on as in the JS
      feedObj = Feed.getFeedObjForLibraryItem(this.userId, itemExpanded!, this.slug, this.serverAddress)

      feedEpisodeCreateFuncEntity = itemExpanded
      // cast(c): itemExpanded may be null (see NOTE above), but then the line above has already thrown
      if (itemExpanded!.mediaType === 'podcast') {
        feedEpisodeCreateFunc = feedEpisodeModel.createFromPodcastEpisodes.bind(feedEpisodeModel)
      } else {
        feedEpisodeCreateFunc = feedEpisodeModel.createFromAudiobookTracks.bind(feedEpisodeModel)
      }
    } else if (this.entityType === 'collection') {
      const collectionModel = this.sequelize.models.collection

      const collectionExpanded = await collectionModel.getExpandedById(this.entityId)
      // NOTE: collectionExpanded is null when the collection no longer exists, then getFeedObjForCollection throws a TypeError outside the try below
      // cast(c): collectionExpanded may be null (see NOTE above); passed on as in the JS
      const feedObjData = Feed.getFeedObjForCollection(this.userId, collectionExpanded!, this.slug, this.serverAddress)
      feedObj = feedObjData.feedObj
      feedEpisodeCreateFuncEntity = feedObjData.booksWithTracks
      feedEpisodeCreateFunc = feedEpisodeModel.createFromBooks.bind(feedEpisodeModel)
    } else if (this.entityType === 'series') {
      const seriesModel = this.sequelize.models.series

      const seriesExpanded = await seriesModel.getExpandedById(this.entityId)
      // NOTE: seriesExpanded is null when the series no longer exists, then getFeedObjForSeries throws a TypeError outside the try below
      // cast(c): seriesExpanded may be null (see NOTE above); passed on as in the JS
      const feedObjData = Feed.getFeedObjForSeries(this.userId, seriesExpanded!, this.slug, this.serverAddress)
      feedObj = feedObjData.feedObj
      feedEpisodeCreateFuncEntity = feedObjData.booksWithTracks
      feedEpisodeCreateFunc = feedEpisodeModel.createFromBooks.bind(feedEpisodeModel)
    } else {
      Logger.error(`[Feed] Invalid entity type ${this.entityType} for feed ${this.id}`)
      return null
    }

    const transaction = await this.sequelize.transaction()
    try {
      const updatedFeed = await this.update(feedObj, { transaction })

      const existingFeedEpisodeIds = this.feedEpisodes.map((ep) => ep.id)

      // Create new feed episodes
      // cast(d): each branch above pairs the create function with the entity it takes (a podcast or book library item, or books)
      // cast(d): the entity is only null in the library item case noted above, which has already thrown
      updatedFeed.feedEpisodes = await (feedEpisodeCreateFunc as FeedEpisodeCreateFunc)(feedEpisodeCreateFuncEntity!, updatedFeed, this.slug, transaction)

      const newFeedEpisodeIds = updatedFeed.feedEpisodes.map((ep) => ep.id)
      const feedEpisodeIdsToRemove = existingFeedEpisodeIds.filter((epid) => !newFeedEpisodeIds.includes(epid))

      if (feedEpisodeIdsToRemove.length) {
        Logger.info(`[Feed] Removing ${feedEpisodeIdsToRemove.length} episodes from feed ${this.id}`)
        await feedEpisodeModel.destroy({
          where: {
            id: feedEpisodeIdsToRemove
          },
          transaction
        })
      }

      await transaction.commit()

      return updatedFeed
    } catch (error) {
      Logger.error(`[Feed] Error updating feed ${this.entityId}`, error)
      await transaction.rollback()

      return null
    }
  }

  getEntity(options?: FindOptions): Promise<LibraryItem | Collection | Series | Playlist | null> {
    if (!this.entityType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.entityType)}`
    // cast(d): entityType is "libraryItem", "collection", "series" or "playlist", so the name is one of the association getters
    return this[mixinMethodName as 'getLibraryItem' | 'getCollection' | 'getSeries' | 'getPlaylist'](options)
  }

  buildXml(hostPrefix: string) {
    const customElements: RssCustomElement[] = [
      { language: this.language || 'en' },
      { author: this.author || 'advplyr' },
      { 'itunes:author': this.author || 'advplyr' },
      { 'itunes:type': this.podcastType || 'serial' },
      {
        'itunes:image': {
          _attr: {
            href: `${hostPrefix}${this.imageURL}`
          }
        }
      },
      { 'itunes:explicit': !!this.explicit }
    ]

    if (this.description) {
      customElements.push({ 'itunes:summary': { _cdata: this.description } })
    }

    const itunesOwnersData: RssCustomElement[] = []
    if (this.ownerName || this.author) {
      itunesOwnersData.push({ 'itunes:name': this.ownerName || this.author })
    }
    if (this.ownerEmail) {
      itunesOwnersData.push({ 'itunes:email': this.ownerEmail })
    }
    if (itunesOwnersData.length) {
      customElements.push({
        'itunes:owner': itunesOwnersData
      })
    }

    if (this.preventIndexing) {
      customElements.push({ 'itunes:block': 'yes' }, { 'googleplay:block': 'yes' })
    }

    const rssData = {
      title: this.title,
      description: this.description || '',
      generator: 'Audiobookshelf',
      feed_url: `${hostPrefix}${this.feedURL}`,
      site_url: `${hostPrefix}${this.siteURL}`,
      image_url: `${hostPrefix}${this.imageURL}`,
      custom_namespaces: {
        itunes: 'http://www.itunes.com/dtds/podcast-1.0.dtd',
        podcast: 'https://podcastindex.org/namespace/1.0',
        googleplay: 'http://www.google.com/schemas/play-podcasts/1.0'
      },
      custom_elements: customElements
    }

    const rssfeed = new RSS(rssData)
    this.feedEpisodes.forEach((ep) => {
      rssfeed.item(ep.getRSSData(hostPrefix))
    })
    return rssfeed.xml()
  }

  getEpisodePath(id: string): string | null {
    const episode = this.feedEpisodes.find((ep) => ep.id === id)
    if (!episode) return null
    return episode.filePath
  }

  toOldJSON() {
    const episodes = this.feedEpisodes?.map((feedEpisode) => feedEpisode.getOldEpisode())
    return {
      id: this.id,
      slug: this.slug,
      userId: this.userId,
      entityType: this.entityType,
      entityId: this.entityId,
      entityUpdatedAt: this.entityUpdatedAt?.valueOf() || null,
      coverPath: this.coverPath || null,
      meta: {
        title: this.title,
        description: this.description,
        author: this.author,
        imageUrl: this.imageURL,
        feedUrl: this.feedURL,
        link: this.siteURL,
        explicit: this.explicit,
        type: this.podcastType,
        language: this.language,
        preventIndexing: this.preventIndexing,
        ownerName: this.ownerName,
        ownerEmail: this.ownerEmail
      },
      serverAddress: this.serverAddress,
      feedUrl: this.feedURL,
      episodes: episodes || [],
      createdAt: this.createdAt.valueOf(),
      updatedAt: this.updatedAt.valueOf()
    }
  }

  toOldJSONMinified() {
    return {
      id: this.id,
      entityType: this.entityType,
      entityId: this.entityId,
      feedUrl: this.feedURL,
      meta: {
        title: this.title,
        description: this.description,
        preventIndexing: this.preventIndexing,
        ownerName: this.ownerName,
        ownerEmail: this.ownerEmail
      }
    }
  }
}

namespace Feed {
  export type FeedOptions = FeedOptionsObject
  export type FeedExpanded = Feed
}

export = Feed
