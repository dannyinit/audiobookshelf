import Sequelize = require('sequelize')
import DatabaseModule = require('../../Database')
import Logger = require('../../Logger')
import profiler = require('../../utils/profiler')
import stringifySequelizeQuery = require('../stringifySequelizeQuery')
import User = require('../../models/User')
import Library = require('../../models/Library')
import Podcast = require('../../models/Podcast')
import PodcastEpisode = require('../../models/PodcastEpisode')
import LibraryItem = require('../../models/LibraryItem')
import type { CountOptions, FindOptions, Model, ModelStatic, WhereAttributeHash, Order, IncludeOptions } from 'sequelize'
import type { InitializedDatabase } from '../types'
import type { FilteredLibraryItem, MediaGroupQuery, QueryReplacements, RuntimeFindOptions, UserPermissionPodcastWhere, UserPermissions, WhereItem } from './types'
const { profile } = profiler

// cast(d): Database.js is still JS; sequelize is null until Database.init, which runs before any query
const Database = DatabaseModule as InitializedDatabase

const countCache = new Map<string, number>()

/**
 * Podcast loaded with its libraryItem (and optionally the episodes)
 */
type PodcastWithLibraryItem = Podcast & { libraryItem: FilteredLibraryItem; podcastEpisodes?: PodcastEpisode[]; dataValues: Podcast['dataValues'] & { duration: number } }

/**
 * Podcast episode loaded with its podcast and the podcast libraryItem
 */
type EpisodeWithPodcast = PodcastEpisode & { podcast: PodcastWithLibraryItem }

/**
 * Row of the value/count json_each queries
 */
interface ValueCountRow {
  value: string
  numItems: number
}

export = {
  /**
   * User permissions to restrict podcasts for explicit content & tags
   */
  getUserPermissionPodcastWhereQuery(user: User): UserPermissionPodcastWhere {
    const podcastWhere: WhereItem[] = []
    const replacements: QueryReplacements = {}
    if (!user.canAccessExplicitContent) {
      podcastWhere.push({
        explicit: false
      })
    }

    // permissions is a JSON column
    const permissions = user.permissions as UserPermissions | null
    if (!permissions?.accessAllTags && permissions?.itemTagsSelected?.length) {
      replacements['userTagsSelected'] = permissions.itemTagsSelected
      if (permissions.selectedTagsNotAccessible) {
        podcastWhere.push(Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(tags) WHERE json_valid(tags) AND json_each.value IN (:userTagsSelected))`), 0))
      } else {
        podcastWhere.push(
          Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(tags) WHERE json_valid(tags) AND json_each.value IN (:userTagsSelected))`), {
            [Sequelize.Op.gte]: 1
          })
        )
      }
    }

    return {
      podcastWhere,
      replacements
    }
  },

  /**
   * Get where options for Podcast model
   */
  getMediaGroupQuery(group: string | null | undefined, value: string | null | undefined): MediaGroupQuery {
    if (!group) return { mediaWhere: {}, replacements: {} }

    let mediaWhere: Record<string, unknown> = {}
    const replacements: QueryReplacements = {}

    if (['genres', 'tags'].includes(group)) {
      mediaWhere[group] = Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(${group}) WHERE json_valid(${group}) AND json_each.value = :filterValue)`), {
        [Sequelize.Op.gte]: 1
      })
      replacements.filterValue = value
    } else if (group === 'languages') {
      mediaWhere['language'] = value
    } else if (group === 'explicit') {
      mediaWhere['explicit'] = true
    }

    return {
      mediaWhere,
      replacements
    }
  },

  /**
   * Get sequelize order
   */
  getOrder(sortBy: string, sortDesc: boolean): Order {
    const dir = sortDesc ? 'DESC' : 'ASC'
    if (sortBy === 'addedAt') {
      return [[Sequelize.literal('libraryItem.createdAt'), dir]]
    } else if (sortBy === 'size') {
      return [[Sequelize.literal('libraryItem.size'), dir]]
    } else if (sortBy === 'birthtimeMs') {
      return [[Sequelize.literal('libraryItem.birthtime'), dir]]
    } else if (sortBy === 'mtimeMs') {
      return [[Sequelize.literal('libraryItem.mtime'), dir]]
    } else if (sortBy === 'media.metadata.author') {
      const nullDir = sortDesc ? 'DESC NULLS FIRST' : 'ASC NULLS LAST'
      // sequelize accepts an order item with only a literal; its types require a direction
      return [[Sequelize.literal(`\`podcast\`.\`author\` COLLATE NOCASE ${nullDir}`)]] as unknown as Order
    } else if (sortBy === 'media.metadata.title') {
      if (global.ServerSettings.sortingIgnorePrefix) {
        return [[Sequelize.literal('`libraryItem`.`titleIgnorePrefix` COLLATE NOCASE'), dir]]
      } else {
        return [[Sequelize.literal('`libraryItem`.`title` COLLATE NOCASE'), dir]]
      }
    } else if (sortBy === 'media.numTracks') {
      return [['numEpisodes', dir]]
    } else if (sortBy === 'random') {
      return [Database.sequelize.random()]
    }
    return []
  },

  clearCountCache(model: string, hook: string) {
    Logger.debug(`[LibraryItemsPodcastFilters] ${model}.${hook}: Clearing count cache`)
    countCache.clear()
  },

  async findAndCountAll<M extends Model>(findOptions: RuntimeFindOptions, model: ModelStatic<M>, limit: number, offset: number, useCountCache: boolean): Promise<{ rows: M[]; count: number }> {
    if (useCountCache) {
      const countCacheKey = stringifySequelizeQuery(findOptions)
      Logger.debug(`[LibraryItemsPodcastFilters] countCacheKey: ${countCacheKey}`)
      if (!countCache.has(countCacheKey)) {
        // cast(b): RuntimeFindOptions relaxes options to the shapes Sequelize accepts at runtime; its CountOptions type is stricter
        const count = await model.count(findOptions as CountOptions)
        countCache.set(countCacheKey, count)
      }

      findOptions.limit = limit || null
      findOptions.offset = offset

      // cast(b): RuntimeFindOptions relaxes options to the shapes Sequelize accepts at runtime; its FindOptions type is stricter
      const rows = await model.findAll(findOptions as FindOptions)

      // Set above when missing
      return { rows, count: countCache.get(countCacheKey) as number }
    }

    findOptions.limit = limit || null
    findOptions.offset = offset

    // cast(b): RuntimeFindOptions relaxes options to the shapes Sequelize accepts at runtime; its FindOptions type is stricter
    return await model.findAndCountAll(findOptions as FindOptions)
  },

  /**
   * Get library items for podcast media type using filter and sort
   */
  async getFilteredLibraryItems(libraryId: string, user: User, filterGroup: string | null | undefined, filterValue: string | null | undefined, sortBy: string, sortDesc: boolean, include: string[], limit: number, offset: number) {
    const includeRSSFeed = include.includes('rssfeed')
    const includeNumEpisodesIncomplete = include.includes('numepisodesincomplete')

    const libraryItemWhere: Record<string | symbol, unknown> = {
      libraryId
    }
    const libraryItemIncludes: IncludeOptions[] = []
    if (filterGroup === 'feed-open' || includeRSSFeed) {
      const rssFeedRequired = filterGroup === 'feed-open'
      libraryItemIncludes.push({
        model: Database.feedModel,
        required: rssFeedRequired,
        separate: !rssFeedRequired
      })
    }
    if (filterGroup === 'issues') {
      libraryItemWhere[Sequelize.Op.or] = [
        {
          isMissing: true
        },
        {
          isInvalid: true
        }
      ]
    } else if (filterGroup === 'recent') {
      libraryItemWhere['createdAt'] = {
        [Sequelize.Op.gte]: new Date(new Date().valueOf() - 60 * 24 * 60 * 60 * 1000) // 60 days ago
      }
    }

    const podcastIncludes: never[] = []

    let { mediaWhere, replacements } = this.getMediaGroupQuery(filterGroup, filterValue)
    replacements.userId = user.id

    const podcastWhere: WhereItem[] = []
    if (Object.keys(mediaWhere).length) podcastWhere.push(mediaWhere)

    const userPermissionPodcastWhere = this.getUserPermissionPodcastWhereQuery(user)
    replacements = { ...replacements, ...userPermissionPodcastWhere.replacements }
    podcastWhere.push(...userPermissionPodcastWhere.podcastWhere)

    const findOptions: RuntimeFindOptions = {
      where: podcastWhere,
      replacements,
      distinct: true,
      attributes: {
        include: [...podcastIncludes]
      },
      include: [
        {
          model: Database.libraryItemModel,
          required: true,
          where: libraryItemWhere,
          include: libraryItemIncludes
        }
      ],
      order: this.getOrder(sortBy, sortDesc),
      subQuery: false
    }

    const findAndCountAll = process.env.QUERY_PROFILING ? profile(this.findAndCountAll) : this.findAndCountAll

    const { rows: podcasts, count } = await findAndCountAll(findOptions, Database.podcastModel, limit, offset, !filterGroup && !userPermissionPodcastWhere.podcastWhere.length)

    // libraryItem is included above
    const libraryItems = (podcasts as PodcastWithLibraryItem[]).map((podcastExpanded) => {
      const libraryItem = podcastExpanded.libraryItem
      // Typed as optional so it can be deleted
      const podcast = podcastExpanded as Podcast & { libraryItem?: FilteredLibraryItem }

      delete podcast.libraryItem

      if (libraryItem.feeds?.length) {
        libraryItem.rssFeed = libraryItem.feeds[0]
      }

      if (includeNumEpisodesIncomplete) {
        // mediaProgresses is loaded with the user for requests
        const numEpisodesComplete = (user.mediaProgresses as NonNullable<User['mediaProgresses']>).reduce((acc, mp) => {
          if (mp.podcastId === podcast.id && mp.isFinished) {
            acc += 1
          }
          return acc
        }, 0)
        libraryItem.numEpisodesIncomplete = podcast.numEpisodes - numEpisodesComplete
      }

      libraryItem.media = podcast

      return libraryItem
    })

    return {
      libraryItems,
      count
    }
  },

  /**
   * Get podcast episodes filtered and sorted
   * @param isHomePage for home page shelves
   */
  async getFilteredPodcastEpisodes(libraryId: string, user: User, filterGroup: string | null | undefined, filterValue: string | null | undefined, sortBy: string, sortDesc: boolean, limit: number, offset: number, isHomePage = false) {
    if (sortBy === 'progress' && filterGroup !== 'progress') {
      Logger.warn('Cannot sort podcast episodes by progress without filtering by progress')
      sortBy = 'createdAt'
    }

    const podcastEpisodeIncludes: IncludeOptions[] = []
    let podcastEpisodeWhere: WhereAttributeHash | WhereAttributeHash[] = {}
    let libraryItemWhere = {
      libraryId
    }
    if (filterGroup === 'progress') {
      const mediaProgressWhere: Record<string, unknown> = {
        userId: user.id
      }
      // Respect hide from continue listening for home page shelf
      if (isHomePage) {
        mediaProgressWhere.hideFromContinueListening = false
      }
      podcastEpisodeIncludes.push({
        model: Database.mediaProgressModel,
        where: mediaProgressWhere,
        attributes: ['id', 'isFinished', 'currentTime', 'updatedAt']
      })

      if (filterValue === 'in-progress') {
        podcastEpisodeWhere = [
          {
            '$mediaProgresses.isFinished$': false
          },
          {
            '$mediaProgresses.currentTime$': {
              [Sequelize.Op.gt]: 0
            }
          }
        ]
      } else if (filterValue === 'finished') {
        podcastEpisodeWhere['$mediaProgresses.isFinished$'] = true
      }
    } else if (filterGroup === 'recent') {
      podcastEpisodeWhere['createdAt'] = {
        [Sequelize.Op.gte]: new Date(new Date().valueOf() - 60 * 24 * 60 * 60 * 1000) // 60 days ago
      }
    }

    const podcastEpisodeOrder: [string | ReturnType<typeof Sequelize.literal>, string][] = []
    if (sortBy === 'createdAt') {
      podcastEpisodeOrder.push(['createdAt', sortDesc ? 'DESC' : 'ASC'])
    } else if (sortBy === 'progress') {
      podcastEpisodeOrder.push([Sequelize.literal('mediaProgresses.updatedAt'), sortDesc ? 'DESC' : 'ASC'])
    }

    const userPermissionPodcastWhere = this.getUserPermissionPodcastWhereQuery(user)

    const findOptions: RuntimeFindOptions = {
      where: podcastEpisodeWhere,
      replacements: userPermissionPodcastWhere.replacements,
      include: [
        {
          model: Database.podcastModel,
          required: true,
          where: userPermissionPodcastWhere.podcastWhere,
          include: [
            {
              model: Database.libraryItemModel,
              required: true,
              where: libraryItemWhere
            }
          ]
        },
        ...podcastEpisodeIncludes
      ],
      subQuery: false,
      order: podcastEpisodeOrder
    }

    const findAndCountAll = process.env.QUERY_PROFILING ? profile(this.findAndCountAll) : this.findAndCountAll

    const { rows: podcastEpisodes, count } = await findAndCountAll(findOptions, Database.podcastEpisodeModel, limit, offset, !filterGroup)

    // The podcast and its libraryItem are included above
    const libraryItems = (podcastEpisodes as EpisodeWithPodcast[]).map((ep) => {
      const libraryItem = ep.podcast.libraryItem
      // Typed as optional so it can be deleted
      const podcast = ep.podcast as Podcast & { libraryItem?: FilteredLibraryItem }
      delete podcast.libraryItem
      libraryItem.media = podcast

      libraryItem.recentEpisode = ep.toOldJSON(libraryItem.id)
      return libraryItem
    })

    return {
      libraryItems,
      count
    }
  },

  /**
   * Search podcasts
   */
  async search(user: User, library: Library, query: string, limit: number, offset: number) {
    const userPermissionPodcastWhere = this.getUserPermissionPodcastWhereQuery(user)

    const textSearchQuery = await Database.createTextSearchQuery(query)

    const matchTitle = textSearchQuery.matchExpression('podcast.title')
    const matchAuthor = textSearchQuery.matchExpression('podcast.author')

    // Search title, author, itunesId, itunesArtistId
    const podcasts = await Database.podcastModel.findAll({
      where: [
        {
          [Sequelize.Op.or]: [
            Sequelize.literal(matchTitle),
            Sequelize.literal(matchAuthor),
            {
              itunesId: {
                [Sequelize.Op.substring]: query
              }
            },
            {
              itunesArtistId: {
                [Sequelize.Op.substring]: query
              }
            }
          ]
        },
        ...userPermissionPodcastWhere.podcastWhere
      ],
      replacements: userPermissionPodcastWhere.replacements,
      include: [
        {
          model: Database.libraryItemModel,
          where: {
            libraryId: library.id
          }
        }
      ],
      subQuery: false,
      distinct: true,
      limit,
      offset
      // distinct is not a findAll option (sequelize ignores it); kept as before
    } as FindOptions)

    const itemMatches: { libraryItem: ReturnType<LibraryItem['toOldJSONExpanded']> }[] = []

    // libraryItem is included above; typed as optional so it can be deleted
    for (const podcast of podcasts as (Podcast & { libraryItem?: FilteredLibraryItem })[]) {
      // Included above
      const libraryItem = podcast.libraryItem as FilteredLibraryItem
      delete podcast.libraryItem
      libraryItem.media = podcast
      libraryItem.media.podcastEpisodes = []
      itemMatches.push({
        libraryItem: libraryItem.toOldJSONExpanded()
      })
    }

    // Search podcast episode title
    const podcastEpisodes = await Database.podcastEpisodeModel.findAll({
      where: [
        Sequelize.literal(textSearchQuery.matchExpression('podcastEpisode.title')),
        {
          '$podcast.libraryItem.libraryId$': library.id
        }
      ],
      replacements: userPermissionPodcastWhere.replacements,
      include: [
        {
          model: Database.podcastModel,
          where: [...userPermissionPodcastWhere.podcastWhere],
          include: [
            {
              model: Database.libraryItemModel
            }
          ]
        }
      ],
      distinct: true,
      offset,
      limit
      // distinct is not a findAll option (sequelize ignores it); kept as before
    } as FindOptions)
    const episodeMatches: { libraryItem: ReturnType<LibraryItem['toOldJSONExpanded']> & { recentEpisode?: unknown } }[] = []
    // The podcast and its libraryItem are included above
    for (const episode of podcastEpisodes as EpisodeWithPodcast[]) {
      const libraryItem = episode.podcast.libraryItem
      libraryItem.media = episode.podcast
      libraryItem.media.podcastEpisodes = []
      const oldPodcastEpisodeJson = episode.toOldJSONExpanded(libraryItem.id)
      const libraryItemJson: ReturnType<LibraryItem['toOldJSONExpanded']> & { recentEpisode?: unknown } = libraryItem.toOldJSONExpanded()
      libraryItemJson.recentEpisode = oldPodcastEpisodeJson
      episodeMatches.push({
        libraryItem: libraryItemJson
      })
    }

    const matchJsonValue = textSearchQuery.matchExpression('json_each.value')

    // Search tags
    const tagMatches: { name: string; numItems: number }[] = []
    const [tagResultRows] = await Database.sequelize.query(`SELECT value, count(*) AS numItems FROM podcasts p, libraryItems li, json_each(p.tags) WHERE json_valid(p.tags) AND ${matchJsonValue} AND p.id = li.mediaId AND li.libraryId = :libraryId GROUP BY value ORDER BY numItems DESC LIMIT :limit OFFSET :offset;`, {
      replacements: {
        libraryId: library.id,
        limit,
        offset
      },
      raw: true
    })
    // Rows of the query above
    for (const row of tagResultRows as ValueCountRow[]) {
      tagMatches.push({
        name: row.value,
        numItems: row.numItems
      })
    }

    // Search genres
    const genreMatches: { name: string; numItems: number }[] = []
    const [genreResultRows] = await Database.sequelize.query(`SELECT value, count(*) AS numItems FROM podcasts p, libraryItems li, json_each(p.genres) WHERE json_valid(p.genres) AND ${matchJsonValue} AND p.id = li.mediaId AND li.libraryId = :libraryId GROUP BY value ORDER BY numItems DESC LIMIT :limit OFFSET :offset;`, {
      replacements: {
        libraryId: library.id,
        limit,
        offset
      },
      raw: true
    })
    // Rows of the query above
    for (const row of genreResultRows as ValueCountRow[]) {
      genreMatches.push({
        name: row.value,
        numItems: row.numItems
      })
    }

    return {
      podcast: itemMatches,
      tags: tagMatches,
      genres: genreMatches,
      episodes: episodeMatches
    }
  },

  /**
   * Most recent podcast episodes not finished
   */
  async getRecentEpisodes(user: User, library: Library, limit: number, offset: number) {
    const userPermissionPodcastWhere = this.getUserPermissionPodcastWhereQuery(user)

    const findOptions: RuntimeFindOptions = {
      where: {
        '$mediaProgresses.isFinished$': {
          [Sequelize.Op.or]: [null, false]
        }
      },
      replacements: userPermissionPodcastWhere.replacements,
      include: [
        {
          model: Database.podcastModel,
          where: userPermissionPodcastWhere.podcastWhere,
          required: true,
          include: {
            model: Database.libraryItemModel,
            where: {
              libraryId: library.id
            }
          }
        },
        {
          model: Database.mediaProgressModel,
          where: {
            userId: user.id
          },
          required: false
        }
      ],
      order: [['publishedAt', 'DESC']],
      subQuery: false,
      limit,
      offset
    }

    const findtAll = process.env.QUERY_PROFILING ? profile(Database.podcastEpisodeModel.findAll.bind(Database.podcastEpisodeModel)) : Database.podcastEpisodeModel.findAll.bind(Database.podcastEpisodeModel)

    // cast(b): RuntimeFindOptions relaxes options to the shapes Sequelize accepts at runtime; its FindOptions type is stricter
    const episodes = await findtAll(findOptions as FindOptions)

    // The podcast and its libraryItem are included above
    const episodeResults = (episodes as EpisodeWithPodcast[]).map((ep) => {
      ep.podcast.podcastEpisodes = [] // Not needed
      const oldPodcastJson = ep.podcast.toOldJSON(ep.podcast.libraryItem.id)

      const oldPodcastEpisodeJson: ReturnType<PodcastEpisode['toOldJSONExpanded']> & { podcast?: unknown; libraryId?: string } = ep.toOldJSONExpanded(ep.podcast.libraryItem.id)

      oldPodcastEpisodeJson.podcast = oldPodcastJson
      oldPodcastEpisodeJson.libraryId = ep.podcast.libraryItem.libraryId
      return oldPodcastEpisodeJson
    })

    return episodeResults
  },

  /**
   * Get stats for podcast library
   */
  async getPodcastLibraryStats(libraryId: string): Promise<{ totalSize: number; totalDuration: number; numAudioFiles: number; totalItems: number }> {
    const [sizeResultRows] = await Database.sequelize.query(`SELECT SUM(li.size) AS totalSize FROM libraryItems li WHERE li.mediaType = "podcast" AND li.libraryId = :libraryId;`, {
      replacements: {
        libraryId
      }
    })
    const [statResultRows] = await Database.sequelize.query(`SELECT SUM(json_extract(pe.audioFile, '$.duration')) AS totalDuration, COUNT(DISTINCT(li.id)) AS totalItems, COUNT(pe.id) AS numAudioFiles FROM libraryItems li, podcasts p LEFT OUTER JOIN podcastEpisodes pe ON pe.podcastId = p.id WHERE p.id = li.mediaId AND li.libraryId = :libraryId;`, {
      replacements: {
        libraryId
      }
    })
    // Rows of the queries above
    const sizeResults = sizeResultRows as { totalSize: number | null }[]
    // Rows of the queries above
    const statResults = statResultRows as { totalDuration: number | null; numAudioFiles: number; totalItems: number }[]
    return {
      totalDuration: statResults?.[0]?.totalDuration || 0,
      numAudioFiles: statResults?.[0]?.numAudioFiles || 0,
      totalItems: statResults?.[0]?.totalItems || 0,
      totalSize: sizeResults?.[0]?.totalSize || 0
    }
  },

  /**
   * Genres with num podcasts
   */
  async getGenresWithCount(libraryId: string): Promise<{ genre: string; count: number }[]> {
    const genres: { genre: string; count: number }[] = []
    const [genreResultRows] = await Database.sequelize.query(`SELECT value, count(*) AS numItems FROM podcasts p, libraryItems li, json_each(p.genres) WHERE json_valid(p.genres) AND p.id = li.mediaId AND li.libraryId = :libraryId GROUP BY value ORDER BY numItems DESC;`, {
      replacements: {
        libraryId
      },
      raw: true
    })
    // Rows of the query above
    for (const row of genreResultRows as ValueCountRow[]) {
      genres.push({
        genre: row.value,
        count: row.numItems
      })
    }
    return genres
  },

  /**
   * Get longest podcasts in library
   */
  async getLongestPodcasts(libraryId: string, limit: number): Promise<{ id: string; title: string | null; duration: number }[]> {
    const podcasts = await Database.podcastModel.findAll({
      attributes: ['id', 'title', [Sequelize.literal(`(SELECT SUM(json_extract(pe.audioFile, '$.duration')) FROM podcastEpisodes pe WHERE pe.podcastId = podcast.id)`), 'duration']],
      include: {
        model: Database.libraryItemModel,
        attributes: ['id', 'libraryId'],
        where: {
          libraryId
        }
      },
      order: [['duration', 'DESC']],
      limit
    })
    // libraryItem is included above
    return (podcasts as PodcastWithLibraryItem[]).map((podcast) => {
      return {
        id: podcast.libraryItem.id,
        title: podcast.title,
        duration: podcast.dataValues.duration
      }
    })
  }
}
