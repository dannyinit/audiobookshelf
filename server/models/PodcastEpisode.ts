import Sequelize = require('sequelize')
import type { Attributes, CreationAttributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import libraryItemsPodcastFilters = require('../utils/queries/libraryItemsPodcastFilters')
import type AudioFile = require('../objects/files/AudioFile')
import type MediaProgress = require('./MediaProgress')
import type PlaylistMediaItem = require('./PlaylistMediaItem')
import type Podcast = require('./Podcast')
import type { AudioFileObject, AudioTrack, ChapterObject, ModelsSequelize, PodcastEpisodeExtraData, RssPodcastEpisode } from './types'
import type * as ModelTypes from './types'
const { DataTypes, Model } = Sequelize

/**
 * Attributes accepted by create: publishedAt may be epoch ms (the DATE column converts it to a Date)
 */
type PodcastEpisodeCreationAttributes = InferCreationAttributes<PodcastEpisode, { omit: 'publishedAt' }> & {
  publishedAt: Date | number | null
}

class PodcastEpisode extends Model<InferAttributes<PodcastEpisode>, PodcastEpisodeCreationAttributes> {
  declare id: CreationOptional<string>
  declare index: number | null
  declare season: string | null
  declare episode: string | null
  declare episodeType: string | null
  declare title: string | null
  declare subtitle: string | null
  declare description: string | null
  declare pubDate: string
  declare enclosureURL: string | null
  /** BIGINT column, read as a number; a new episode keeps the length string from the RSS enclosure until reloaded */
  declare enclosureSize: number | string | null
  declare enclosureType: string | null
  declare publishedAt: Date | null
  declare audioFile: AudioFileObject
  declare chapters: ChapterObject[]
  declare extraData: PodcastEpisodeExtraData | null
  declare podcastId: string
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  // Associations, only set when included

  declare podcast: NonAttribute<Podcast>
  declare mediaProgresses?: NonAttribute<MediaProgress[]>
  declare playlistMediaItem?: NonAttribute<PlaylistMediaItem>

  static async createFromRssPodcastEpisode(rssPodcastEpisode: RssPodcastEpisode, podcastId: string, audioFile: AudioFile) {
    const podcastEpisode: CreationAttributes<PodcastEpisode> & { extraData: PodcastEpisodeExtraData } = {
      index: null,
      season: rssPodcastEpisode.season,
      episode: rssPodcastEpisode.episode,
      episodeType: rssPodcastEpisode.episodeType,
      title: rssPodcastEpisode.title,
      subtitle: rssPodcastEpisode.subtitle,
      description: rssPodcastEpisode.description,
      pubDate: rssPodcastEpisode.pubDate,
      enclosureURL: rssPodcastEpisode.enclosure?.url || null,
      enclosureSize: rssPodcastEpisode.enclosure?.length || null,
      enclosureType: rssPodcastEpisode.enclosure?.type || null,
      publishedAt: rssPodcastEpisode.publishedAt,
      podcastId,
      // cast(d): the audio file was probed, so the fields that AudioFile types as nullable before construct are set
      audioFile: audioFile.toJSON() as AudioFileObject,
      chapters: [],
      extraData: {}
    }
    if (rssPodcastEpisode.guid) {
      podcastEpisode.extraData.guid = rssPodcastEpisode.guid
    }

    if (audioFile.chapters?.length) {
      podcastEpisode.chapters = audioFile.chapters.map((ch) => ({ ...ch }))
    } else if (rssPodcastEpisode.chapters?.length) {
      // NOTE: RSS chapters can have end null (the last chapter when no end time is given), which is stored as is in chapters
      // cast(c): the JS stores the RSS chapters in a chapters column typed with a numeric end; see the NOTE above
      podcastEpisode.chapters = rssPodcastEpisode.chapters.map((ch) => ({ ...ch })) as ChapterObject[]
    }

    return this.create(podcastEpisode)
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
        index: DataTypes.INTEGER,
        season: DataTypes.STRING,
        episode: DataTypes.STRING,
        episodeType: DataTypes.STRING,
        title: DataTypes.STRING,
        subtitle: DataTypes.STRING(1000),
        description: DataTypes.TEXT,
        pubDate: DataTypes.STRING,
        enclosureURL: DataTypes.STRING,
        enclosureSize: DataTypes.BIGINT,
        enclosureType: DataTypes.STRING,
        publishedAt: DataTypes.DATE,

        audioFile: DataTypes.JSON,
        chapters: DataTypes.JSON,
        extraData: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'podcastEpisode',
        indexes: [
          {
            name: 'podcastEpisode_createdAt_podcastId',
            fields: ['createdAt', 'podcastId']
          },
          {
            name: 'podcast_episodes_published_at',
            fields: ['publishedAt']
          }
        ]
      }
    )

    const { podcast } = sequelize.models
    podcast.hasMany(PodcastEpisode, {
      onDelete: 'CASCADE'
    })
    PodcastEpisode.belongsTo(podcast)

    PodcastEpisode.addHook('afterDestroy', async (instance) => {
      libraryItemsPodcastFilters.clearCountCache('podcastEpisode', 'afterDestroy')
    })

    PodcastEpisode.addHook('afterCreate', async (instance) => {
      libraryItemsPodcastFilters.clearCountCache('podcastEpisode', 'afterCreate')
    })
  }

  get size(): NonAttribute<number> {
    return this.audioFile?.metadata.size || 0
  }

  get duration(): NonAttribute<number> {
    return this.audioFile?.duration || 0
  }

  /**
   * Used for matching the episode with an episode in the RSS feed
   */
  checkMatchesGuidOrEnclosureUrl(guid: string | null, enclosureURL: string): boolean {
    if (this.extraData?.guid && this.extraData.guid === guid) {
      return true
    }
    if (this.enclosureURL && this.enclosureURL === enclosureURL) {
      return true
    }
    return false
  }

  /**
   * Used in client players
   */
  getAudioTrack(libraryItemId: string): AudioTrack {
    // cast(d): the clone gets the track properties (startOffset, title, contentUrl) assigned below
    const track = structuredClone(this.audioFile) as AudioTrack
    track.startOffset = 0
    track.title = this.audioFile.metadata.filename
    track.index = 1 // Podcast episodes only have one track
    track.contentUrl = `/api/items/${libraryItemId}/file/${track.ino}`
    return track
  }

  toOldJSON(libraryItemId: string) {
    if (!libraryItemId) {
      throw new Error(`[PodcastEpisode] Cannot convert to old JSON because libraryItemId is not provided`)
    }

    let enclosure = null
    if (this.enclosureURL) {
      enclosure = {
        url: this.enclosureURL,
        type: this.enclosureType,
        length: this.enclosureSize !== null ? String(this.enclosureSize) : null
      }
    }

    return {
      libraryItemId: libraryItemId,
      podcastId: this.podcastId,
      id: this.id,
      oldEpisodeId: this.extraData?.oldEpisodeId || null,
      index: this.index,
      season: this.season,
      episode: this.episode,
      episodeType: this.episodeType,
      title: this.title,
      subtitle: this.subtitle,
      description: this.description,
      enclosure,
      guid: this.extraData?.guid || null,
      pubDate: this.pubDate,
      chapters: structuredClone(this.chapters),
      audioFile: structuredClone(this.audioFile),
      publishedAt: this.publishedAt?.valueOf() || null,
      addedAt: this.createdAt.valueOf(),
      updatedAt: this.updatedAt.valueOf()
    }
  }

  toOldJSONExpanded(libraryItemId: string) {
    // Typed with the expanded properties, which are added below
    const json: ReturnType<PodcastEpisode['toOldJSON']> & { audioTrack?: AudioTrack; size?: number; duration?: number } = this.toOldJSON(libraryItemId)

    json.audioTrack = this.getAudioTrack(libraryItemId)
    json.size = this.size
    json.duration = this.duration

    return json
  }
}

namespace PodcastEpisode {
  export type ChapterObject = ModelTypes.ChapterObject
}

export = PodcastEpisode
