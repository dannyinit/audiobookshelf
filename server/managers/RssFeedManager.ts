import type { Request, Response } from 'express'
import type { Includeable } from 'sequelize'
import Path = require('path')

import Logger = require('../Logger')
import fileUtils = require('../utils/fileUtils')
import SocketAuthority = require('../SocketAuthority')
import Database = require('../Database')

import fs = require('../libs/fsExtra')
import type Feed = require('../models/Feed')
import type LibraryItem = require('../models/LibraryItem')
import type Collection = require('../models/Collection')
import type Series = require('../models/Series')
const { getAudioMimeTypeFromExtname } = fileUtils

/**
 * Feed metadata details from the open feed request body
 */
interface FeedMetadataDetails {
  preventIndexing?: unknown
  ownerName?: unknown
  ownerEmail?: unknown
}

/**
 * Open feed request body (the RSS feed controller checks serverAddress and slug)
 */
interface OpenFeedOptions {
  serverAddress: string
  slug: string
  metadataDetails?: FeedMetadataDetails | null
}

/**
 * Request with the host prefix that Server.js sets for the feed routes
 */
type FeedRequest = Request & { originalHostPrefix: string }

class RssFeedManager {
  constructor() {}

  /**
   * Remove invalid feeds (invalid if the entity does not exist)
   */
  async init() {
    const feeds = await Database.feedModel.findAll({
      attributes: ['id', 'entityId', 'entityType', 'title'],
      include: [
        {
          model: Database.libraryItemModel,
          attributes: ['id']
        },
        {
          model: Database.collectionModel,
          attributes: ['id']
        },
        {
          model: Database.seriesModel,
          attributes: ['id']
        }
      ]
    })

    const feedIdsToRemove: string[] = []
    for (const feed of feeds) {
      if (!feed.entity) {
        Logger.error(`[RssFeedManager] Removing feed "${feed.title}". Entity not found`)
        feedIdsToRemove.push(feed.id)
      }
    }

    if (feedIdsToRemove.length) {
      Logger.info(`[RssFeedManager] Removing ${feedIdsToRemove.length} invalid feeds`)
      await Database.feedModel.destroy({
        where: {
          id: feedIdsToRemove
        }
      })
    }
  }

  /**
   * Find open feed for an entity (e.g. collection id, playlist id, library item id)
   */
  findFeedForEntityId(entityId: string) {
    return Database.feedModel.findOne({
      where: {
        entityId
      }
    })
  }

  checkExistsBySlug(slug: string): Promise<boolean> {
    return Database.feedModel
      .count({
        where: {
          slug
        }
      })
      .then((count) => count > 0)
  }

  /**
   * Feed requires update if the entity (or child entities) has been updated since the feed was last updated
   */
  async checkFeedRequiresUpdate(feed: Feed): Promise<boolean> {
    if (feed.entityType === 'libraryItem') {
      // NOTE: getEntity returns null when the library item no longer exists; the reads below then throw a TypeError
      // cast(c): assigned as in the JS (see NOTE above)
      feed.entity = (await feed.getEntity({
        attributes: ['id', 'updatedAt', 'mediaId', 'mediaType']
      })) as LibraryItem

      let newEntityUpdatedAt = feed.entity.updatedAt

      if (feed.entity.mediaType === 'podcast') {
        const mostRecentPodcastEpisode = await Database.podcastEpisodeModel.findOne({
          where: {
            podcastId: feed.entity.mediaId
          },
          attributes: ['id', 'updatedAt'],
          order: [['updatedAt', 'DESC']]
        })

        if (mostRecentPodcastEpisode && mostRecentPodcastEpisode.updatedAt > newEntityUpdatedAt) {
          newEntityUpdatedAt = mostRecentPodcastEpisode.updatedAt
        }
      } else {
        const book = await Database.bookModel.findOne({
          where: {
            id: feed.entity.mediaId
          },
          attributes: ['id', 'updatedAt']
        })
        if (book && book.updatedAt > newEntityUpdatedAt) {
          newEntityUpdatedAt = book.updatedAt
        }
      }

      return newEntityUpdatedAt > feed.entityUpdatedAt
    } else if (feed.entityType === 'collection' || feed.entityType === 'series') {
      // NOTE: getEntity returns null when the collection or series no longer exists; the reads below then throw a TypeError
      // cast(c): assigned as in the JS (see NOTE above)
      feed.entity = (await feed.getEntity({
        attributes: ['id', 'updatedAt'],
        // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
        include: {
          model: Database.bookModel,
          attributes: ['id', 'audioFiles', 'updatedAt'],
          through: {
            attributes: []
          },
          include: {
            model: Database.libraryItemModel,
            attributes: ['id', 'updatedAt']
          }
        } as unknown as Includeable
      })) as Collection | Series

      const totalBookTracks = feed.entity.books.reduce((total, book) => total + book.includedAudioFiles.length, 0)
      if (feed.feedEpisodes.length !== totalBookTracks) {
        return true
      }

      let newEntityUpdatedAt: Date | number = feed.entity.updatedAt

      const mostRecentItemUpdatedAt = feed.entity.books.reduce<Date | number>((mostRecent, book) => {
        let updatedAt = book.libraryItem.updatedAt > book.updatedAt ? book.libraryItem.updatedAt : book.updatedAt
        return updatedAt > mostRecent ? updatedAt : mostRecent
      }, 0)

      if (mostRecentItemUpdatedAt > newEntityUpdatedAt) {
        newEntityUpdatedAt = mostRecentItemUpdatedAt
      }

      return newEntityUpdatedAt > feed.entityUpdatedAt
    } else {
      throw new Error('Invalid feed entity type')
    }
  }

  /**
   * GET: /feed/:slug
   */
  async getFeed(req: FeedRequest, res: Response) {
    let feed = await Database.feedModel.findOne({
      where: {
        slug: req.params.slug
      },
      include: {
        model: Database.feedEpisodeModel
      }
    })
    if (!feed) {
      Logger.warn(`[RssFeedManager] Feed not found ${req.params.slug}`)
      res.sendStatus(404)
      return
    }

    const feedRequiresUpdate = await this.checkFeedRequiresUpdate(feed)
    if (feedRequiresUpdate) {
      Logger.info(`[RssFeedManager] Feed "${feed.title}" requires update - updating feed`)
      // NOTE: updateFeedForEntity returns null when the update fails; feed.buildXml below then throws a TypeError
      // cast(c): assigned as in the JS (see NOTE above)
      feed = (await feed.updateFeedForEntity()) as Feed
    }

    const xml = feed.buildXml(req.originalHostPrefix)
    res.set('Content-Type', 'text/xml')
    res.send(xml)
  }

  /**
   * GET: /feed/:slug/item/:episodeId/*
   */
  async getFeedItem(req: Request, res: Response) {
    const feed = await Database.feedModel.findOne({
      where: {
        slug: req.params.slug
      },
      attributes: ['id', 'slug'],
      include: {
        model: Database.feedEpisodeModel,
        attributes: ['id', 'filePath']
      }
    })

    if (!feed) {
      Logger.debug(`[RssFeedManager] Feed not found ${req.params.slug}`)
      res.sendStatus(404)
      return
    }
    const episodePath = feed.getEpisodePath(req.params.episodeId)
    if (!episodePath) {
      Logger.error(`[RssFeedManager] Feed episode not found ${req.params.episodeId}`)
      res.sendStatus(404)
      return
    }
    // Express does not set the correct mimetype for m4b files so use our defined mimetypes if available
    const audioMimeType = getAudioMimeTypeFromExtname(Path.extname(episodePath))
    if (audioMimeType) {
      res.setHeader('Content-Type', audioMimeType)
    }
    res.sendFile(episodePath)
  }

  /**
   * GET: /feed/:slug/cover*
   */
  async getFeedCover(req: Request, res: Response) {
    const feed = await Database.feedModel.findOne({
      where: {
        slug: req.params.slug
      },
      attributes: ['coverPath']
    })
    if (!feed) {
      Logger.debug(`[RssFeedManager] Feed not found ${req.params.slug}`)
      res.sendStatus(404)
      return
    }

    if (!feed.coverPath) {
      res.sendStatus(404)
      return
    }

    const extname = Path.extname(feed.coverPath).toLowerCase().slice(1)
    res.type(`image/${extname}`)
    const readStream = fs.createReadStream(feed.coverPath)

    readStream.on('error', (error) => {
      Logger.error(`[RssFeedManager] Error streaming cover image: ${error.message}`)
      // Only send error if headers haven't been sent yet
      if (!res.headersSent) {
        res.sendStatus(404)
      }
    })

    readStream.pipe(res)
  }

  getFeedOptionsFromReqOptions(options: OpenFeedOptions): Feed.FeedOptions {
    const metadataDetails: FeedMetadataDetails = options.metadataDetails || {}

    if (metadataDetails.preventIndexing !== false) {
      metadataDetails.preventIndexing = true
    }

    return {
      // cast(d): any value other than false was replaced by true just above
      preventIndexing: metadataDetails.preventIndexing as boolean,
      ownerName: metadataDetails.ownerName && typeof metadataDetails.ownerName === 'string' ? metadataDetails.ownerName : null,
      ownerEmail: metadataDetails.ownerEmail && typeof metadataDetails.ownerEmail === 'string' ? metadataDetails.ownerEmail : null
    }
  }

  async openFeedForItem(userId: string, libraryItem: LibraryItem.LibraryItemExpanded, options: OpenFeedOptions) {
    const serverAddress = options.serverAddress
    const slug = options.slug
    const feedOptions = this.getFeedOptionsFromReqOptions(options)

    Logger.info(`[RssFeedManager] Creating RSS feed for item ${libraryItem.id} "${libraryItem.media.title}"`)
    const feedExpanded = await Database.feedModel.createFeedForLibraryItem(userId, libraryItem, slug, serverAddress, feedOptions)
    if (feedExpanded) {
      Logger.info(`[RssFeedManager] Opened RSS feed "${feedExpanded.feedURL}"`)
      SocketAuthority.emitter('rss_feed_open', feedExpanded.toOldJSONMinified())
    }
    return feedExpanded
  }

  async openFeedForCollection(userId: string, collectionExpanded: Collection, options: OpenFeedOptions) {
    const serverAddress = options.serverAddress
    const slug = options.slug
    const feedOptions = this.getFeedOptionsFromReqOptions(options)

    Logger.info(`[RssFeedManager] Creating RSS feed for collection "${collectionExpanded.name}"`)
    const feedExpanded = await Database.feedModel.createFeedForCollection(userId, collectionExpanded, slug, serverAddress, feedOptions)
    if (feedExpanded) {
      Logger.info(`[RssFeedManager] Opened RSS feed "${feedExpanded.feedURL}"`)
      SocketAuthority.emitter('rss_feed_open', feedExpanded.toOldJSONMinified())
    }
    return feedExpanded
  }

  async openFeedForSeries(userId: string, seriesExpanded: Series, options: OpenFeedOptions) {
    const serverAddress = options.serverAddress
    const slug = options.slug
    const feedOptions = this.getFeedOptionsFromReqOptions(options)

    Logger.info(`[RssFeedManager] Creating RSS feed for series "${seriesExpanded.name}"`)
    const feedExpanded = await Database.feedModel.createFeedForSeries(userId, seriesExpanded, slug, serverAddress, feedOptions)
    if (feedExpanded) {
      Logger.info(`[RssFeedManager] Opened RSS feed "${feedExpanded.feedURL}"`)
      SocketAuthority.emitter('rss_feed_open', feedExpanded.toOldJSONMinified())
    }
    return feedExpanded
  }

  /**
   * Close Feed and emit Socket event
   *
   * @returns true if feed was closed
   */
  async handleCloseFeed(feed: Feed | null | undefined): Promise<boolean> {
    if (!feed) return false
    const wasRemoved = await Database.feedModel.removeById(feed.id)
    SocketAuthority.emitter('rss_feed_closed', feed.toOldJSONMinified())
    Logger.info(`[RssFeedManager] Closed RSS feed "${feed.feedURL}"`)
    return wasRemoved
  }

  /**
   * @returns true if feed was closed
   */
  async closeFeedForEntityId(entityId: string) {
    const feed = await Database.feedModel.findOne({
      where: {
        entityId
      }
    })
    if (!feed) {
      return false
    }
    return this.handleCloseFeed(feed)
  }

  async closeFeedsForEntityIds(entityIds: string[]) {
    const feeds = await Database.feedModel.findAll({
      where: {
        entityId: entityIds
      }
    })
    for (const feed of feeds) {
      await this.handleCloseFeed(feed)
    }
  }

  getFeeds() {
    return Database.feedModel.findAll({
      include: {
        model: Database.feedEpisodeModel
      }
    })
  }
}
export = new RssFeedManager()
