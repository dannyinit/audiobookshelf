import { DataTypes, Model, Sequelize } from 'sequelize'
import libraryItemsPodcastFilters = require('../utils/queries/libraryItemsPodcastFilters')
type ChapterObject = PodcastEpisode.ChapterObject

class PodcastEpisode extends Model {
  /** @type {string} */
  declare id: string
  /** @type {number} */
  declare index: number
  /** @type {string} */
  declare season: string
  /** @type {string} */
  declare episode: string
  /** @type {string} */
  declare episodeType: string
  /** @type {string} */
  declare title: string
  /** @type {string} */
  declare subtitle: string
  /** @type {string} */
  declare description: string
  /** @type {string} */
  declare pubDate: string
  /** @type {string} */
  declare enclosureURL: string
  /** @type {BigInt} */
  declare enclosureSize: BigInt
  /** @type {string} */
  declare enclosureType: string
  /** @type {Date} */
  declare publishedAt: Date
  /** @type {import('./Book').AudioFileObject} */
  declare audioFile: import('./Book').AudioFileObject
  /** @type {ChapterObject[]} */
  declare chapters: ChapterObject[]
  /** @type {Object} */
  declare extraData: object
  /** @type {string} */
  declare podcastId: string
  /** @type {Date} */
  declare createdAt: Date
  /** @type {Date} */
  declare updatedAt: Date

  /**
   *
   * @param {import('../utils/podcastUtils').RssPodcastEpisode} rssPodcastEpisode
   * @param {string} podcastId
   * @param {import('../objects/files/AudioFile')} audioFile
   */
  static async createFromRssPodcastEpisode(rssPodcastEpisode: import('../utils/podcastUtils').RssPodcastEpisode, podcastId: string, audioFile: import('../objects/files/AudioFile')) {
    const podcastEpisode = {
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
      audioFile: audioFile.toJSON(),
      chapters: [],
      extraData: {}
    }
    if (rssPodcastEpisode.guid) {
      podcastEpisode.extraData.guid = rssPodcastEpisode.guid
    }

    if (audioFile.chapters?.length) {
      podcastEpisode.chapters = audioFile.chapters.map((ch) => ({ ...ch }))
    } else if (rssPodcastEpisode.chapters?.length) {
      podcastEpisode.chapters = rssPodcastEpisode.chapters.map((ch) => ({ ...ch }))
    }

    return this.create(podcastEpisode)
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

  get size() {
    return this.audioFile?.metadata.size || 0
  }

  get duration() {
    return this.audioFile?.duration || 0
  }

  /**
   * Used for matching the episode with an episode in the RSS feed
   *
   * @param {string} guid
   * @param {string} enclosureURL
   * @returns {boolean}
   */
  checkMatchesGuidOrEnclosureUrl(guid: string, enclosureURL: string): boolean {
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
   *
   * @param {string} libraryItemId
   * @returns {import('./Book').AudioTrack}
   */
  getAudioTrack(libraryItemId: string): import('./Book').AudioTrack {
    const track = structuredClone(this.audioFile)
    track.startOffset = 0
    track.title = this.audioFile.metadata.filename
    track.index = 1 // Podcast episodes only have one track
    track.contentUrl = `/api/items/${libraryItemId}/file/${track.ino}`
    return track
  }

  toOldJSON(libraryItemId) {
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

  toOldJSONExpanded(libraryItemId) {
    const json = this.toOldJSON(libraryItemId)

    json.audioTrack = this.getAudioTrack(libraryItemId)
    json.size = this.size
    json.duration = this.duration

    return json
  }
}

namespace PodcastEpisode {
  export interface ChapterObject {
    id: number
    start: number
    end: number
    title: string
  }
}

export = PodcastEpisode
