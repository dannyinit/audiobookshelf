import Sequelize = require('sequelize')
import type { Attributes, BelongsToGetAssociationMixin, CreationOptional, FindOptions, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute, UpsertOptions, WhereOptions } from 'sequelize'
import oldPlaybackSession = require('../objects/PlaybackSession')
import type { PlaybackMediaMetadata } from '../utils/types'
import type Book = require('./Book')
import type Device = require('./Device')
import type PodcastEpisode = require('./PodcastEpisode')
import type { ModelsSequelize, PlaybackSessionExtraData, UpdateValues } from './types'
const { DataTypes, Model } = Sequelize

/**
 * Old playback session (objects/PlaybackSession) as passed to createFromOld/updateFromOld, which is stored with its id and user set
 */
type OldPlaybackSession = Omit<oldPlaybackSession, 'id' | 'userId'> & { id: string; userId: string }

/**
 * Attributes accepted by create/upsert: the old session timestamps are epoch ms (the DATE columns convert them to Dates)
 */
type PlaybackSessionCreationAttributes = InferCreationAttributes<PlaybackSession, { omit: 'createdAt' | 'updatedAt' }> & {
  createdAt?: Date | number | null
  updatedAt?: Date | number | null
}

/**
 * dataValues of a loaded session with the included media item (moved to mediaItem by the afterFind hook)
 */
type PlaybackSessionDataValues = InferAttributes<PlaybackSession> & {
  book?: Book
  podcastEpisode?: PodcastEpisode
  mediaItem?: Book | PodcastEpisode
}

class PlaybackSession extends Model<InferAttributes<PlaybackSession>, PlaybackSessionCreationAttributes> {
  declare id: CreationOptional<string>
  declare mediaItemId: string | null
  declare mediaItemType: string
  declare displayTitle: string | null
  declare displayAuthor: string | null
  declare duration: number | null
  declare playMethod: number | null
  declare mediaPlayer: string | null
  declare startTime: number | null
  declare currentTime: number
  declare serverVersion: string | null
  declare coverPath: string | null
  declare timeListening: number | null
  declare mediaMetadata: PlaybackMediaMetadata | null
  declare date: string | null
  declare dayOfWeek: string | null
  declare extraData: PlaybackSessionExtraData | null
  declare userId: string
  declare deviceId: string | null
  declare libraryId: string | null
  declare updatedAt: CreationOptional<Date>
  declare createdAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize
  declare static readonly sequelize: ModelsSequelize

  // Expanded properties

  /** Set by the afterFind hook when the book or podcast episode is included */
  declare mediaItem?: NonAttribute<Book | PodcastEpisode>

  // Associations, only set when included (the afterFind hook moves book or podcastEpisode to mediaItem and deletes them)

  declare device?: NonAttribute<Device>
  declare book?: NonAttribute<Book>
  declare podcastEpisode?: NonAttribute<PodcastEpisode>

  declare getBook: BelongsToGetAssociationMixin<Book>
  declare getPodcastEpisode: BelongsToGetAssociationMixin<PodcastEpisode>

  static async getOldPlaybackSessions(where: WhereOptions<PlaybackSession> | null = null) {
    const playbackSessions = await this.findAll({
      // cast(b): sequelize accepts a null where (no condition), its types do not
      where: where as WhereOptions<PlaybackSession>,
      include: [
        {
          model: this.sequelize.models.device
        }
      ]
    })
    return playbackSessions.map((session) => this.getOldPlaybackSession(session))
  }

  static async getById(sessionId: string) {
    const playbackSession = await this.findByPk(sessionId, {
      include: [
        {
          model: this.sequelize.models.device
        }
      ]
    })
    if (!playbackSession) return null
    return this.getOldPlaybackSession(playbackSession)
  }

  static getOldPlaybackSession(playbackSessionExpanded: PlaybackSession) {
    const isPodcastEpisode = playbackSessionExpanded.mediaItemType === 'podcastEpisode'

    return new oldPlaybackSession({
      id: playbackSessionExpanded.id,
      userId: playbackSessionExpanded.userId,
      libraryId: playbackSessionExpanded.libraryId,
      libraryItemId: playbackSessionExpanded.extraData?.libraryItemId || null,
      bookId: isPodcastEpisode ? null : playbackSessionExpanded.mediaItemId,
      episodeId: isPodcastEpisode ? playbackSessionExpanded.mediaItemId : null,
      mediaType: isPodcastEpisode ? 'podcast' : 'book',
      mediaMetadata: playbackSessionExpanded.mediaMetadata,
      chapters: null,
      displayTitle: playbackSessionExpanded.displayTitle,
      displayAuthor: playbackSessionExpanded.displayAuthor,
      coverPath: playbackSessionExpanded.coverPath,
      duration: playbackSessionExpanded.duration,
      playMethod: playbackSessionExpanded.playMethod,
      mediaPlayer: playbackSessionExpanded.mediaPlayer,
      deviceInfo: playbackSessionExpanded.device?.getOldDevice() || null,
      serverVersion: playbackSessionExpanded.serverVersion,
      date: playbackSessionExpanded.date,
      dayOfWeek: playbackSessionExpanded.dayOfWeek,
      timeListening: playbackSessionExpanded.timeListening,
      startTime: playbackSessionExpanded.startTime,
      currentTime: playbackSessionExpanded.currentTime,
      startedAt: playbackSessionExpanded.createdAt.valueOf(),
      updatedAt: playbackSessionExpanded.updatedAt.valueOf()
    })
  }

  static removeById(sessionId: string) {
    return this.destroy({
      where: {
        id: sessionId
      }
    })
  }

  static createFromOld(oldPlaybackSession: OldPlaybackSession) {
    const playbackSession = this.getFromOld(oldPlaybackSession)
    return this.upsert(playbackSession, {
      silent: true
      // cast(b): the JS passes silent, which UpsertOptions does not declare
    } as unknown as UpsertOptions<InferAttributes<PlaybackSession>>)
  }

  static updateFromOld(oldPlaybackSession: OldPlaybackSession) {
    const playbackSession = this.getFromOld(oldPlaybackSession)
    // cast(b): the old session timestamps are epoch ms, which the DATE columns accept; update types the values with the Date attributes
    return this.update(playbackSession as unknown as UpdateValues<InferAttributes<PlaybackSession>>, {
      where: {
        id: playbackSession.id
      },
      silent: true
    })
  }

  static getFromOld(oldPlaybackSession: OldPlaybackSession) {
    return {
      id: oldPlaybackSession.id,
      mediaItemId: oldPlaybackSession.episodeId || oldPlaybackSession.bookId,
      mediaItemType: oldPlaybackSession.episodeId ? 'podcastEpisode' : 'book',
      libraryId: oldPlaybackSession.libraryId,
      displayTitle: oldPlaybackSession.displayTitle,
      displayAuthor: oldPlaybackSession.displayAuthor,
      duration: oldPlaybackSession.duration,
      playMethod: oldPlaybackSession.playMethod,
      mediaPlayer: oldPlaybackSession.mediaPlayer,
      startTime: oldPlaybackSession.startTime,
      currentTime: oldPlaybackSession.currentTime,
      serverVersion: oldPlaybackSession.serverVersion || null,
      createdAt: oldPlaybackSession.startedAt,
      updatedAt: oldPlaybackSession.updatedAt,
      userId: oldPlaybackSession.userId,
      deviceId: oldPlaybackSession.deviceInfo?.id || null,
      timeListening: oldPlaybackSession.timeListening,
      coverPath: oldPlaybackSession.coverPath,
      mediaMetadata: oldPlaybackSession.mediaMetadata,
      date: oldPlaybackSession.date,
      dayOfWeek: oldPlaybackSession.dayOfWeek,
      extraData: {
        libraryItemId: oldPlaybackSession.libraryItemId
      }
    }
  }

  getMediaItem(options?: FindOptions): Promise<Book | PodcastEpisode | null> {
    if (!this.mediaItemType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.mediaItemType)}`
    // cast(d): mediaItemType is "book" or "podcastEpisode", so the name is one of the association getters
    return this[mixinMethodName as 'getBook' | 'getPodcastEpisode'](options)
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
        mediaItemId: DataTypes.UUID,
        mediaItemType: DataTypes.STRING,
        displayTitle: DataTypes.STRING,
        displayAuthor: DataTypes.STRING,
        duration: DataTypes.FLOAT,
        playMethod: DataTypes.INTEGER,
        mediaPlayer: DataTypes.STRING,
        startTime: DataTypes.FLOAT,
        currentTime: DataTypes.FLOAT,
        serverVersion: DataTypes.STRING,
        coverPath: DataTypes.STRING,
        timeListening: DataTypes.INTEGER,
        mediaMetadata: DataTypes.JSON,
        date: DataTypes.STRING,
        dayOfWeek: DataTypes.STRING,
        extraData: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'playbackSession'
      }
    )

    const { book, podcastEpisode, user, device, library } = sequelize.models

    user.hasMany(PlaybackSession)
    PlaybackSession.belongsTo(user)

    device.hasMany(PlaybackSession)
    PlaybackSession.belongsTo(device)

    library.hasMany(PlaybackSession)
    PlaybackSession.belongsTo(library)

    book.hasMany(PlaybackSession, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'book'
      }
    })
    PlaybackSession.belongsTo(book, { foreignKey: 'mediaItemId', constraints: false })

    podcastEpisode.hasOne(PlaybackSession, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'podcastEpisode'
      }
    })
    PlaybackSession.belongsTo(podcastEpisode, { foreignKey: 'mediaItemId', constraints: false })

    PlaybackSession.addHook('afterFind', (findResult: PlaybackSession[] | PlaybackSession | null) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]

      for (const instance of findResult) {
        // Same object as instance.dataValues, typed with the included rows
        const dataValues: PlaybackSessionDataValues = instance.dataValues
        if (instance.mediaItemType === 'book' && instance.book !== undefined) {
          instance.mediaItem = instance.book
          dataValues.mediaItem = dataValues.book
        } else if (instance.mediaItemType === 'podcastEpisode' && instance.podcastEpisode !== undefined) {
          instance.mediaItem = instance.podcastEpisode
          dataValues.mediaItem = dataValues.podcastEpisode
        }
        // To prevent mistakes:
        delete instance.book
        delete dataValues.book
        delete instance.podcastEpisode
        delete dataValues.podcastEpisode
      }
    })
  }
}

export = PlaybackSession
