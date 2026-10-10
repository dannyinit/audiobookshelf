import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute, Transaction } from 'sequelize'
import utils = require('../utils')
import Logger = require('../Logger')
import libraryItemsPodcastFilters = require('../utils/queries/libraryItemsPodcastFilters')
import htmlSanitizer = require('../utils/htmlSanitizer')
import type LibraryItem = require('./LibraryItem')
import type PodcastEpisode = require('./PodcastEpisode')
import type { AudioTrack, ChapterObject, ModelsSequelize, RssPodcastEpisode } from './types'
const { DataTypes, Model } = Sequelize
const { getTitlePrefixAtEnd, getTitleIgnorePrefix } = utils

/**
 * Podcast metadata in a request payload (old podcast metadata keys), not validated yet.
 * A type alias (not an interface) so it can be read and written by key through a Record alias.
 */
type PodcastMetadataPayload = {
  title?: unknown
  author?: unknown
  description?: unknown
  releaseDate?: unknown
  genres?: unknown
  feedUrl?: unknown
  imageUrl?: unknown
  itunesPageUrl?: unknown
  itunesId?: unknown
  itunesArtistId?: unknown
  explicit?: unknown
  language?: unknown
  type?: unknown
}

/**
 * Old podcast object in a request payload (/api/podcasts POST, library item media PATCH), not validated yet
 */
type PodcastRequestPayload = {
  metadata?: PodcastMetadataPayload
  tags?: unknown
  autoDownloadEpisodes?: unknown
  autoDownloadSchedule?: unknown
  lastEpisodeCheck?: unknown
  maxEpisodesToKeep?: unknown
  maxNewEpisodesToDownload?: unknown
}

/**
 * lastEpisodeCheck is read as a Date (or null); it is also set to epoch ms, which the DATE column converts to a Date
 */
interface Podcast {
  get lastEpisodeCheck(): Date | null
  set lastEpisodeCheck(value: Date | number | null)
}

class Podcast extends Model<InferAttributes<Podcast>, InferCreationAttributes<Podcast>> {
  declare id: CreationOptional<string>
  declare title: string | null
  declare titleIgnorePrefix: string | null
  declare author: string | null
  declare releaseDate: string | null
  declare feedURL: string | null
  declare imageURL: string | null
  declare description: string | null
  declare itunesPageURL: string | null
  declare itunesId: string | null
  declare itunesArtistId: string | null
  declare language: string | null
  declare podcastType: string | null
  declare explicit: boolean
  declare autoDownloadEpisodes: boolean
  declare autoDownloadSchedule: string | null
  declare maxEpisodesToKeep: number
  declare maxNewEpisodesToDownload: number
  declare coverPath: CreationOptional<string | null>
  declare tags: string[]
  declare genres: string[]
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
  declare numEpisodes: CreationOptional<number>

  // Expanded properties

  declare podcastEpisodes: NonAttribute<PodcastEpisode[]>

  // Associations, only set when included

  declare libraryItem?: NonAttribute<LibraryItem>

  /**
   * Payload from the /api/podcasts POST endpoint
   */
  static async createFromRequest(payload: PodcastRequestPayload & { metadata: PodcastMetadataPayload }, transaction: Transaction) {
    const title = typeof payload.metadata.title === 'string' ? payload.metadata.title : null
    // cron expression validated in controller
    const autoDownloadSchedule = typeof payload.autoDownloadSchedule === 'string' ? payload.autoDownloadSchedule : null
    const genres = Array.isArray(payload.metadata.genres) && payload.metadata.genres.every((g) => typeof g === 'string' && g.length) ? payload.metadata.genres : []
    const tags = Array.isArray(payload.tags) && payload.tags.every((t) => typeof t === 'string' && t.length) ? payload.tags : []

    const stringKeys = ['title', 'author', 'releaseDate', 'feedUrl', 'imageUrl', 'description', 'itunesPageUrl', 'itunesId', 'itunesArtistId', 'language', 'type']
    // Same object as payload.metadata, read and written by key
    const metadataValues: Record<string, unknown> = payload.metadata
    stringKeys.forEach((key) => {
      if (typeof metadataValues[key] === 'number') {
        metadataValues[key] = String(metadataValues[key])
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

  get hasMediaFiles(): NonAttribute<boolean> {
    return !!this.podcastEpisodes?.length
  }

  get hasAudioTracks(): NonAttribute<boolean> {
    return this.hasMediaFiles
  }

  get size(): NonAttribute<number> {
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
   * @param payload - Old podcast object
   */
  async updateFromRequest(payload: PodcastRequestPayload): Promise<boolean> {
    if (!payload) return false

    let hasUpdates = false

    if (payload.metadata) {
      const stringKeys = ['title', 'author', 'releaseDate', 'feedUrl', 'imageUrl', 'description', 'itunesPageUrl', 'itunesId', 'itunesArtistId', 'language', 'type']
      // Same objects as payload.metadata and this, read and written by key (the setters of this still run)
      const metadataValues: Record<string, unknown> = payload.metadata
      // cast(d): a model instance has no index signature; newKey below is always a string attribute of the podcast
      const self = this as unknown as Record<string, unknown>
      stringKeys.forEach((key) => {
        // Convert numbers to strings
        if (typeof metadataValues[key] === 'number') {
          metadataValues[key] = String(metadataValues[key])
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
        if ((typeof metadataValues[key] === 'string' || metadataValues[key] === null) && metadataValues[key] !== self[newKey]) {
          // Sanitize description HTML
          if (key === 'description' && metadataValues[key]) {
            const sanitizedDescription = htmlSanitizer.sanitize(metadataValues[key])
            if (sanitizedDescription !== metadataValues[key]) {
              Logger.debug(`[Podcast] "${this.title}" Sanitized description from "${metadataValues[key]}" to "${sanitizedDescription}"`)
              metadataValues[key] = sanitizedDescription
            }
          }

          self[newKey] = metadataValues[key] || null

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

      if (Array.isArray(payload.metadata.genres) && !payload.metadata.genres.some((item) => typeof item !== 'string') && JSON.stringify(this.genres) !== JSON.stringify(payload.metadata.genres)) {
        this.genres = payload.metadata.genres
        this.changed('genres', true)
        hasUpdates = true
      }
    }

    if (Array.isArray(payload.tags) && !payload.tags.some((item) => typeof item !== 'string') && JSON.stringify(this.tags) !== JSON.stringify(payload.tags)) {
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
      this.lastEpisodeCheck = payload.lastEpisodeCheck
      hasUpdates = true
    }

    const numberKeys: ('maxEpisodesToKeep' | 'maxNewEpisodesToDownload')[] = ['maxEpisodesToKeep', 'maxNewEpisodesToDownload']
    numberKeys.forEach((key) => {
      if (typeof payload[key] === 'number' && payload[key] !== this[key]) {
        this[key] = payload[key]
        hasUpdates = true
      }
    })

    if (hasUpdates) {
      Logger.debug(`[Podcast] changed keys:`, this.changed())
      await this.save()
    }

    return hasUpdates
  }

  checkCanDirectPlay(supportedMimeTypes: string[], episodeId: string | null | undefined): boolean {
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
   */
  getTracklist(libraryItemId: string, episodeId: string): AudioTrack[] {
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] getTracklist: episode not found`, episodeId)
      return []
    }

    const audioTrack = episode.getAudioTrack(libraryItemId)
    return [audioTrack]
  }

  getChapters(episodeId: string): ChapterObject[] {
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] getChapters: episode not found`, episodeId)
      return []
    }

    return structuredClone(episode.chapters) || []
  }

  getPlaybackTitle(episodeId: string | null) {
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

  getPlaybackDuration(episodeId: string | null) {
    const episode = this.podcastEpisodes.find((ep) => ep.id === episodeId)
    if (!episode) {
      Logger.error(`[Podcast] getPlaybackDuration: episode not found`, episodeId)
      return 0
    }

    return episode.duration
  }

  /**
   * @returns Unix timestamp
   */
  getLatestEpisodePublishedAt(): number {
    return this.podcastEpisodes.reduce((latest, episode) => {
      // cast(d): undefined > latest is false, as in the JS
      if ((episode.publishedAt?.valueOf() as number) > latest) {
        // cast(d): publishedAt is set (the comparison above is false for null)
        return episode.publishedAt!.valueOf()
      }
      return latest
    }, 0)
  }

  /**
   * Used for checking if an rss feed episode is already in the podcast
   *
   * @param feedEpisode - object from rss feed
   */
  checkHasEpisodeByFeedEpisode(feedEpisode: RssPodcastEpisode): boolean {
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
    // Typed with titleIgnorePrefix, which is added below
    const oldMetadataJSON: ReturnType<Podcast['oldMetadataToJSON']> & { titleIgnorePrefix?: string | null } = this.oldMetadataToJSON()
    oldMetadataJSON.titleIgnorePrefix = getTitlePrefixAtEnd(this.title)
    return oldMetadataJSON
  }

  /**
   * The old model stored episodes with the podcast object
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
  export type PodcastExpanded = Podcast
  /** Podcast loaded with its library item (playlists) */
  export type PodcastExpandedWithLibraryItem = Podcast & { libraryItem: LibraryItem }
}

export = Podcast
