import { DataTypes, Model, Sequelize } from 'sequelize'
import { getTitlePrefixAtEnd, getTitleIgnorePrefix } from '../utils'
import Logger = require('../Logger')
import libraryItemsPodcastFilters = require('../utils/queries/libraryItemsPodcastFilters')
import htmlSanitizer = require('../utils/htmlSanitizer')

type PodcastExpandedProperties = Podcast.PodcastExpandedProperties

type PodcastExpanded = Podcast.PodcastExpanded

class Podcast extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare title: string
  /** @type {string} */
  declare titleIgnorePrefix: string
  /** @type {string} */
  declare author: string
  /** @type {string} */
  declare releaseDate: string
  /** @type {string} */
  declare feedURL: string
  /** @type {string} */
  declare imageURL: string
  /** @type {string} */
  declare description: string
  /** @type {string} */
  declare itunesPageURL: string
  /** @type {string} */
  declare itunesId: string
  /** @type {string} */
  declare itunesArtistId: string
  /** @type {string} */
  declare language: string
  /** @type {string} */
  declare podcastType: string
  /** @type {boolean} */
  declare explicit: boolean
  /** @type {boolean} */
  declare autoDownloadEpisodes: boolean
  /** @type {string} */
  declare autoDownloadSchedule: string
  /** @type {Date} */
  declare lastEpisodeCheck: Date
  /** @type {number} */
  declare maxEpisodesToKeep: number
  /** @type {number} */
  declare maxNewEpisodesToDownload: number
  /** @type {string} */
  declare coverPath: string
  /** @type {string[]} */
  declare tags: string[]
  /** @type {string[]} */
  declare genres: string[]
  /** @type {Date} */
  declare createdAt: Date
  /** @type {Date} */
  declare updatedAt: Date
  /** @type {number} */
  declare numEpisodes: number
  /** @type {import('./PodcastEpisode')[]} */
  declare podcastEpisodes: import('./PodcastEpisode')[]
  /** only set when included */
  declare libraryItem?: import('./LibraryItem')

  /**
   * Payload from the /api/podcasts POST endpoint
   *
   * @param {Object} payload
   * @param {import('sequelize').Transaction} transaction
   */
  static async createFromRequest(payload: Record<string, any>, transaction: import('sequelize').Transaction) {
    const title = typeof payload.metadata.title === 'string' ? payload.metadata.title : null
    // cron expression validated in controller
    const autoDownloadSchedule = typeof payload.autoDownloadSchedule === 'string' ? payload.autoDownloadSchedule : null
    const genres = Array.isArray(payload.metadata.genres) && payload.metadata.genres.every((g: unknown) => typeof g === 'string' && g.length) ? payload.metadata.genres : []
    const tags = Array.isArray(payload.tags) && payload.tags.every((t) => typeof t === 'string' && t.length) ? payload.tags : []

    const stringKeys = ['title', 'author', 'releaseDate', 'feedUrl', 'imageUrl', 'description', 'itunesPageUrl', 'itunesId', 'itunesArtistId', 'language', 'type']
    stringKeys.forEach((key) => {
      if (typeof payload.metadata[key] === 'number') {
        payload.metadata[key] = String(payload.metadata[key])
      }
    })

    const rawDescription = typeof payload.metadata.description === 'string' ? payload.metadata.description : null
    const description = rawDescription ? htmlSanitizer.sanitize(rawDescription) : null

    return this.create(
      {
        title,
        titleIgnorePrefix: getTitleIgnorePrefix(title),
        author: typeof payload.metadata.author === 'string' ? payload.metadata.author : null,
        releaseDate: typeof payload.metadata.releaseDate === 'string' ? payload.metadata.releaseDate : null,
        feedURL: typeof payload.metadata.feedUrl === 'string' ? payload.metadata.feedUrl : null,
        imageURL: typeof payload.metadata.imageUrl === 'string' ? payload.metadata.imageUrl : null,
        description,
        itunesPageURL: typeof payload.metadata.itunesPageUrl === 'string' ? payload.metadata.itunesPageUrl : null,
        itunesId: typeof payload.metadata.itunesId === 'string' ? payload.metadata.itunesId : null,
        itunesArtistId: typeof payload.metadata.itunesArtistId === 'string' ? payload.metadata.itunesArtistId : null,
        language: typeof payload.metadata.language === 'string' ? payload.metadata.language : null,
        podcastType: typeof payload.metadata.type === 'string' ? payload.metadata.type : null,
        explicit: !!payload.metadata.explicit,
        autoDownloadEpisodes: !!payload.autoDownloadEpisodes,
        autoDownloadSchedule: autoDownloadSchedule || global.ServerSettings.podcastEpisodeSchedule,
        lastEpisodeCheck: new Date(),
        maxEpisodesToKeep: 0,
        maxNewEpisodesToDownload: 3,
        tags,
        genres
      },
      { transaction }
    )
  }

  /**
   * Initialize model
   * @param sequelize
   */
  static initModel(sequelize: Sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        title: DataTypes.STRING,
        titleIgnorePrefix: DataTypes.STRING,
        author: DataTypes.STRING,
        releaseDate: DataTypes.STRING,
        feedURL: DataTypes.STRING,
        imageURL: DataTypes.STRING,
        description: DataTypes.TEXT,
        itunesPageURL: DataTypes.STRING,
        itunesId: DataTypes.STRING,
        itunesArtistId: DataTypes.STRING,
        language: DataTypes.STRING,
        podcastType: DataTypes.STRING,
        explicit: DataTypes.BOOLEAN,

        autoDownloadEpisodes: DataTypes.BOOLEAN,
        autoDownloadSchedule: DataTypes.STRING,
        lastEpisodeCheck: DataTypes.DATE,
        maxEpisodesToKeep: DataTypes.INTEGER,
        maxNewEpisodesToDownload: DataTypes.INTEGER,
        coverPath: DataTypes.STRING,
        tags: DataTypes.JSON,
        genres: DataTypes.JSON,
        numEpisodes: DataTypes.INTEGER
      },
      {
        sequelize,
        modelName: 'podcast'
      }
    )

    Podcast.addHook('afterDestroy', async (instance) => {
      libraryItemsPodcastFilters.clearCountCache('podcast', 'afterDestroy')
    })

    Podcast.addHook('afterCreate', async (instance) => {
      libraryItemsPodcastFilters.clearCountCache('podcast', 'afterCreate')
    })
  }

  get hasMediaFiles() {
    return !!this.podcastEpisodes?.length
  }

  get hasAudioTracks() {
    return this.hasMediaFiles
  }

  get size() {
    if (!this.podcastEpisodes?.length) return 0
    return this.podcastEpisodes.reduce((total, episode) => total + episode.size, 0)
  }

  getAbsMetadataJson() {
    return {
      tags: this.tags || [],
      title: this.title,
      author: this.author,
      description: this.description,
      releaseDate: this.releaseDate,
      genres: this.genres || [],
      feedURL: this.feedURL,
      imageURL: this.imageURL,
      itunesPageURL: this.itunesPageURL,
      itunesId: this.itunesId,
      itunesArtistId: this.itunesArtistId,
      language: this.language,
      explicit: !!this.explicit,
      podcastType: this.podcastType
    }
  }

  /**
   *
   * @param {Object} payload - Old podcast object
   * @returns {Promise<boolean>}
   */
  async updateFromRequest(payload: Record<string, any>): Promise<boolean> {
    if (!payload) return false

    let hasUpdates = false

    if (payload.metadata) {
      const stringKeys = ['title', 'author', 'releaseDate', 'feedUrl', 'imageUrl', 'description', 'itunesPageUrl', 'itunesId', 'itunesArtistId', 'language', 'type']
      stringKeys.forEach((key) => {
        // Convert numbers to strings
        if (typeof payload.metadata[key] === 'number') {
          payload.metadata[key] = String(payload.metadata[key])
        }

        let newKey = key
        if (key === 'type') {
          newKey = 'podcastType'
        } else if (key === 'feedUrl') {
          newKey = 'feedURL'
        } else if (key === 'imageUrl') {
          newKey = 'imageURL'
        } else if (key === 'itunesPageUrl') {
          newKey = 'itunesPageURL'
        }
        const podcast = this as Record<string, any>
        if ((typeof payload.metadata[key] === 'string' || payload.metadata[key] === null) && payload.metadata[key] !== podcast[newKey]) {
          // Sanitize description HTML
          if (key === 'description' && payload.metadata[key]) {
            const sanitizedDescription = htmlSanitizer.sanitize(payload.metadata[key])
            if (sanitizedDescription !== payload.metadata[key]) {
              Logger.debug(`[Podcast] "${this.title}" Sanitized description from "${payload.metadata[key]}" to "${sanitizedDescription}"`)
              payload.metadata[key] = sanitizedDescription
            }
          }

          podcast[newKey] = payload.metadata[key] || null

          if (key === 'title') {
            this.titleIgnorePrefix = getTitleIgnorePrefix(this.title)
          }

          hasUpdates = true
        }
      })

      if (payload.metadata.explicit !== undefined && payload.metadata.explicit !== this.explicit) {
        this.explicit = !!payload.metadata.explicit
        hasUpdates = true
      }

      if (Array.isArray(payload.metadata.genres) && !payload.metadata.genres.some((item: unknown) => typeof item !== 'string') && JSON.stringify(this.genres) !== JSON.stringify(payload.metadata.genres)) {
        this.genres = payload.metadata.genres
        this.changed('genres', true)
        hasUpdates = true
      }
    }

    if (Array.isArray(payload.tags) && !payload.tags.some((item: unknown) => typeof item !== 'string') && JSON.stringify(this.tags) !== JSON.stringify(payload.tags)) {
      this.tags = payload.tags
      this.changed('tags', true)
      hasUpdates = true
    }

    if (payload.autoDownloadEpisodes !== undefined && payload.autoDownloadEpisodes !== this.autoDownloadEpisodes) {
      this.autoDownloadEpisodes = !!payload.autoDownloadEpisodes
      hasUpdates = true
    }
    if (typeof payload.autoDownloadSchedule === 'string' && payload.autoDownloadSchedule !== this.autoDownloadSchedule) {
      // cron expression validated in controller
      this.autoDownloadSchedule = payload.autoDownloadSchedule
      hasUpdates = true
    }
    if (typeof payload.lastEpisodeCheck === 'number' && payload.lastEpisodeCheck !== this.lastEpisodeCheck?.valueOf()) {
      // Attribute setter converts the epoch ms to a Date
      this.set('lastEpisodeCheck', payload.lastEpisodeCheck)
      hasUpdates = true
    }

    const numberKeys = ['maxEpisodesToKeep', 'maxNewEpisodesToDownload']
    numberKeys.forEach((key) => {
      const podcast = this as Record<string, any>
      if (typeof payload[key] === 'number' && payload[key] !== podcast[key]) {
        podcast[key] = payload[key]
        hasUpdates = true
      }
    })

    if (hasUpdates) {
      Logger.debug(`[Podcast] changed keys:`, this.changed())
      await this.save()
    }

    return hasUpdates
  }

  checkCanDirectPlay(supportedMimeTypes: string[], episodeId?: string | null) {
    if (!Array.isArray(supportedMimeTypes)) {
      Logger.error(`[Podcast] checkCanDirectPlay: supportedMimeTypes is not an array`, supportedMimeTypes)
      return false
    }
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] checkCanDirectPlay: episode not found`, episodeId)
      return false
    }
    return supportedMimeTypes.includes(episode.audioFile.mimeType)
  }

  /**
   * Get the track list to be used in client audio players
   * AudioTrack is the AudioFile with startOffset and contentUrl
   * Podcast episodes only have one track
   *
   * @param {string} libraryItemId
   * @param {string} episodeId
   * @returns {import('./Book').AudioTrack[]}
   */
  getTracklist(libraryItemId: string, episodeId?: string | null): import('./Book').AudioTrack[] {
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] getTracklist: episode not found`, episodeId)
      return []
    }

    const audioTrack = episode.getAudioTrack(libraryItemId)
    return [audioTrack]
  }

  /**
   *
   * @param {string} episodeId
   * @returns {import('./PodcastEpisode').ChapterObject[]}
   */
  getChapters(episodeId?: string | null): import('./PodcastEpisode').ChapterObject[] {
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] getChapters: episode not found`, episodeId)
      return []
    }

    return structuredClone(episode.chapters) || []
  }

  getPlaybackTitle(episodeId?: string | null) {
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] getPlaybackTitle: episode not found`, episodeId)
      return ''
    }

    return episode.title
  }

  getPlaybackAuthor() {
    return this.author
  }

  getPlaybackDuration(episodeId?: string | null) {
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] getPlaybackDuration: episode not found`, episodeId)
      return 0
    }

    return episode.duration
  }

  /**
   *
   * @returns {number} - Unix timestamp
   */
  getLatestEpisodePublishedAt(): number {
    return this.podcastEpisodes.reduce((latest, episode) => {
      if (episode.publishedAt?.valueOf() > latest) {
        return episode.publishedAt.valueOf()
      }
      return latest
    }, 0)
  }

  /**
   * Used for checking if an rss feed episode is already in the podcast
   *
   * @param {import('../utils/podcastUtils').RssPodcastEpisode} feedEpisode - object from rss feed
   * @returns {boolean}
   */
  checkHasEpisodeByFeedEpisode(feedEpisode: import('../utils/podcastUtils').RssPodcastEpisode): boolean {
    const guid = feedEpisode.guid
    const url = feedEpisode.enclosure.url
    return this.podcastEpisodes.some((ep) => ep.checkMatchesGuidOrEnclosureUrl(guid, url))
  }

  /**
   * Old model kept metadata in a separate object
   */
  oldMetadataToJSON() {
    return {
      title: this.title,
      author: this.author,
      description: this.description,
      releaseDate: this.releaseDate,
      genres: [...(this.genres || [])],
      feedUrl: this.feedURL,
      imageUrl: this.imageURL,
      itunesPageUrl: this.itunesPageURL,
      itunesId: this.itunesId,
      itunesArtistId: this.itunesArtistId,
      explicit: this.explicit,
      language: this.language,
      type: this.podcastType
    }
  }

  oldMetadataToJSONExpanded() {
    return {
      ...this.oldMetadataToJSON(),
      titleIgnorePrefix: getTitlePrefixAtEnd(this.title)
    }
  }

  /**
   * The old model stored episodes with the podcast object
   *
   * @param {string} libraryItemId
   */
  toOldJSON(libraryItemId: string) {
    if (!libraryItemId) {
      throw new Error(`[Podcast] Cannot convert to old JSON because libraryItemId is not provided`)
    }
    if (!this.podcastEpisodes) {
      throw new Error(`[Podcast] Cannot convert to old JSON because episodes are not provided`)
    }

    return {
      id: this.id,
      libraryItemId: libraryItemId,
      metadata: this.oldMetadataToJSON(),
      coverPath: this.coverPath,
      tags: [...(this.tags || [])],
      episodes: this.podcastEpisodes.map((episode) => episode.toOldJSON(libraryItemId)),
      autoDownloadEpisodes: this.autoDownloadEpisodes,
      autoDownloadSchedule: this.autoDownloadSchedule,
      lastEpisodeCheck: this.lastEpisodeCheck?.valueOf() || null,
      maxEpisodesToKeep: this.maxEpisodesToKeep,
      maxNewEpisodesToDownload: this.maxNewEpisodesToDownload
    }
  }

  /**
   * Minified podcast JSON for list/shelf endpoints.
   * `toOldJSONExpanded()` must be a strict superset: every key here must exist in expanded
   * with the same value semantics. Only additive changes to expanded; never remove or rename keys.
   */
  toOldJSONMinified() {
    return {
      id: this.id,
      // Minified metadata and expanded metadata are the same
      metadata: this.oldMetadataToJSONExpanded(),
      coverPath: this.coverPath,
      tags: [...(this.tags || [])],
      numEpisodes: this.podcastEpisodes?.length || 0,
      autoDownloadEpisodes: this.autoDownloadEpisodes,
      autoDownloadSchedule: this.autoDownloadSchedule,
      lastEpisodeCheck: this.lastEpisodeCheck?.valueOf() || null,
      maxEpisodesToKeep: this.maxEpisodesToKeep,
      maxNewEpisodesToDownload: this.maxNewEpisodesToDownload,
      size: this.size
    }
  }

  /**
   * Expanded podcast JSON for item detail and socket events.
   * Must be a strict superset of `toOldJSONMinified()` — built by spreading minified, then adding expanded-only fields.
   *
   * @param {string} libraryItemId
   */
  toOldJSONExpanded(libraryItemId: string) {
    if (!libraryItemId) {
      throw new Error(`[Podcast] Cannot convert to old JSON because libraryItemId is not provided`)
    }
    if (!this.podcastEpisodes) {
      throw new Error(`[Podcast] Cannot convert to old JSON because episodes are not provided`)
    }

    return {
      ...this.toOldJSONMinified(),
      libraryItemId,
      episodes: this.podcastEpisodes.map((e) => e.toOldJSONExpanded(libraryItemId))
    }
  }
}

namespace Podcast {
  export interface PodcastExpandedProperties {
    podcastEpisodes: import('./PodcastEpisode')[]
  }

  export type PodcastExpanded = Podcast & PodcastExpandedProperties
}

export = Podcast
