import { DataTypes, Model, Sequelize } from 'sequelize'

import oldPlaybackSession = require('../objects/PlaybackSession')

class PlaybackSession extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare mediaItemId: string
  /** @type {string} */
  declare mediaItemType: string
  /** @type {string} */
  declare displayTitle: string
  /** @type {string} */
  declare displayAuthor: string
  /** @type {number} */
  declare duration: number
  /** @type {number} */
  declare playMethod: number
  /** @type {string} */
  declare mediaPlayer: string
  /** @type {number} */
  declare startTime: number
  /** @type {number} */
  declare currentTime: number
  /** @type {string} */
  declare serverVersion: string
  /** @type {string} */
  declare coverPath: string
  /** @type {number} */
  declare timeListening: number
  /** @type {Object} */
  declare mediaMetadata: Record<string, any>
  /** @type {string} */
  declare date: string
  /** @type {string} */
  declare dayOfWeek: string
  /** @type {Object} */
  declare extraData: Record<string, any>
  /** @type {string} */
  declare userId: string
  /** @type {string} */
  declare deviceId: string
  /** @type {string} */
  declare libraryId: string
  /** @type {Date} */
  declare updatedAt: Date
  /** @type {Date} */
  declare createdAt: Date

  static async getOldPlaybackSessions(where = null) {
    const playbackSessions = await this.findAll({
      where,
      include: [
        {
          model: this.sequelize!.models.device
        }
      ]
    })
    return playbackSessions.map((session) => this.getOldPlaybackSession(session))
  }

  static async getById(sessionId) {
    const playbackSession = await this.findByPk(sessionId, {
      include: [
        {
          model: this.sequelize!.models.device
        }
      ]
    })
    if (!playbackSession) return null
    return this.getOldPlaybackSession(playbackSession)
  }

  static getOldPlaybackSession(playbackSessionExpanded) {
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

  static removeById(sessionId) {
    return this.destroy({
      where: {
        id: sessionId
      }
    })
  }

  static createFromOld(oldPlaybackSession) {
    const playbackSession = this.getFromOld(oldPlaybackSession)
    return this.upsert(playbackSession, {
      silent: true
    })
  }

  static updateFromOld(oldPlaybackSession) {
    const playbackSession = this.getFromOld(oldPlaybackSession)
    return this.update(playbackSession, {
      where: {
        id: playbackSession.id
      },
      silent: true
    })
  }

  static getFromOld(oldPlaybackSession) {
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

  getMediaItem(options) {
    if (!this.mediaItemType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.mediaItemType)}`
    return this[mixinMethodName](options)
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

    PlaybackSession.addHook('afterFind', (findResult) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]

      for (const instance of findResult) {
        if (instance.mediaItemType === 'book' && instance.book !== undefined) {
          instance.mediaItem = instance.book
          instance.dataValues.mediaItem = instance.dataValues.book
        } else if (instance.mediaItemType === 'podcastEpisode' && instance.podcastEpisode !== undefined) {
          instance.mediaItem = instance.podcastEpisode
          instance.dataValues.mediaItem = instance.dataValues.podcastEpisode
        }
        // To prevent mistakes:
        delete instance.book
        delete instance.dataValues.book
        delete instance.podcastEpisode
        delete instance.dataValues.podcastEpisode
      }
    })
  }
}

export = PlaybackSession
