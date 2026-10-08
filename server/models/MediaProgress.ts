import Sequelize = require('sequelize')
import type { Attributes, BelongsToGetAssociationMixin, CreationOptional, FindOptions, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import Logger = require('../Logger')
import utils = require('../utils')
import type Book = require('./Book')
import type PodcastEpisode = require('./PodcastEpisode')
import type User = require('./User')
import type { MediaProgressExtraData, ModelsSequelize } from './types'
const { DataTypes, Model } = Sequelize
const { isNullOrNaN } = utils

/**
 * Attributes accepted by create: finishedAt may be a date string or epoch ms (the DATE column converts it to a Date)
 */
type MediaProgressCreationAttributes = InferCreationAttributes<MediaProgress, { omit: 'finishedAt' | 'createdAt' }> & {
  finishedAt: Date | number | string | null
  createdAt?: Date | number | string
}

/**
 * dataValues of a loaded media progress with the included media item (moved to mediaItem by the afterFind hook)
 */
type MediaProgressDataValues = InferAttributes<MediaProgress> & {
  book?: Book
  podcastEpisode?: PodcastEpisode
  mediaItem?: Book | PodcastEpisode
}

/**
 * finishedAt is read as a Date (or null); it is also set to epoch ms or a date string, which the DATE column converts to a Date
 */
interface MediaProgress {
  get finishedAt(): Date | null
  set finishedAt(value: Date | number | string | null)
}

class MediaProgress extends Model<InferAttributes<MediaProgress>, MediaProgressCreationAttributes> {
  declare id: CreationOptional<string>
  declare mediaItemId: string
  declare mediaItemType: string
  declare duration: number
  declare currentTime: number
  declare isFinished: boolean
  declare hideFromContinueListening: boolean
  declare ebookLocation: string | null
  declare ebookProgress: number | null
  declare extraData: MediaProgressExtraData | null
  declare userId: string
  declare updatedAt: CreationOptional<Date>
  declare createdAt: CreationOptional<Date>
  declare podcastId: string | null

  declare sequelize: ModelsSequelize

  // Expanded properties

  /** Set by the afterFind hook when the book or podcast episode is included */
  declare mediaItem?: NonAttribute<Book | PodcastEpisode>

  // Associations, only set when included (the afterFind hook moves book or podcastEpisode to mediaItem and deletes them)

  declare book?: NonAttribute<Book>
  declare podcastEpisode?: NonAttribute<PodcastEpisode>
  declare user?: NonAttribute<User>

  declare getBook: BelongsToGetAssociationMixin<Book>
  declare getPodcastEpisode: BelongsToGetAssociationMixin<PodcastEpisode>

  static removeById(mediaProgressId: string) {
    return this.destroy({
      where: {
        id: mediaProgressId
      }
    })
  }

  /**
   * Initialize model
   *
   * Polymorphic association: Book has many MediaProgress. PodcastEpisode has many MediaProgress.
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
        mediaItemId: DataTypes.UUID,
        mediaItemType: DataTypes.STRING,
        duration: DataTypes.FLOAT,
        currentTime: DataTypes.FLOAT,
        isFinished: DataTypes.BOOLEAN,
        hideFromContinueListening: DataTypes.BOOLEAN,
        ebookLocation: DataTypes.STRING,
        ebookProgress: DataTypes.FLOAT,
        finishedAt: DataTypes.DATE,
        extraData: DataTypes.JSON,
        podcastId: DataTypes.UUID
      },
      {
        sequelize,
        modelName: 'mediaProgress',
        indexes: [
          {
            fields: ['updatedAt']
          },
          {
            name: 'media_progresses_user_item_finished_time',
            fields: ['userId', 'mediaItemId', 'isFinished', 'currentTime']
          }
        ]
      }
    )

    const { book, podcastEpisode, user } = sequelize.models

    book.hasMany(MediaProgress, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'book'
      }
    })
    MediaProgress.belongsTo(book, { foreignKey: 'mediaItemId', constraints: false })

    podcastEpisode.hasMany(MediaProgress, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'podcastEpisode'
      }
    })
    MediaProgress.belongsTo(podcastEpisode, { foreignKey: 'mediaItemId', constraints: false })

    MediaProgress.addHook('afterFind', (findResult: MediaProgress[] | MediaProgress | null) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]

      for (const instance of findResult) {
        // Same object as instance.dataValues, typed with the included rows
        const dataValues: MediaProgressDataValues = instance.dataValues
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

    // make sure to call the afterDestroy hook for each instance
    MediaProgress.addHook('beforeBulkDestroy', (options) => {
      options.individualHooks = true
    })

    // update the potentially cached user after destroying the media progress
    MediaProgress.addHook('afterDestroy', (instance: MediaProgress) => {
      user.mediaProgressRemoved(instance)
    })

    user.hasMany(MediaProgress, {
      onDelete: 'CASCADE'
    })
    MediaProgress.belongsTo(user)
  }

  getMediaItem(options?: FindOptions): Promise<Book | PodcastEpisode | null> {
    if (!this.mediaItemType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.mediaItemType)}`
    // cast(d): mediaItemType is "book" or "podcastEpisode", so the name is one of the association getters
    return this[mixinMethodName as 'getBook' | 'getPodcastEpisode'](options)
  }

  getOldMediaProgress() {
    const isPodcastEpisode = this.mediaItemType === 'podcastEpisode'

    return {
      id: this.id,
      userId: this.userId,
      libraryItemId: this.extraData?.libraryItemId || null,
      episodeId: isPodcastEpisode ? this.mediaItemId : null,
      mediaItemId: this.mediaItemId,
      mediaItemType: this.mediaItemType,
      duration: this.duration,
      progress: this.extraData?.progress || 0,
      currentTime: this.currentTime,
      isFinished: !!this.isFinished,
      hideFromContinueListening: !!this.hideFromContinueListening,
      ebookLocation: this.ebookLocation,
      ebookProgress: this.ebookProgress,
      lastUpdate: this.updatedAt.valueOf(),
      startedAt: this.createdAt.valueOf(),
      finishedAt: this.finishedAt?.valueOf() || null
    }
  }

  get progress(): NonAttribute<number> {
    // Value between 0 and 1
    if (!this.duration) return 0
    return Math.max(0, Math.min(this.currentTime / this.duration, 1))
  }

  /**
   * Apply update to media progress
   */
  async applyProgressUpdate(progressPayload: User.ProgressUpdatePayload): Promise<MediaProgress> {
    if (!this.extraData) this.extraData = {}
    if (progressPayload.isFinished !== undefined) {
      if (progressPayload.isFinished && !this.isFinished) {
        this.finishedAt = progressPayload.finishedAt || Date.now()
        this.extraData.progress = 1
        this.changed('extraData', true)
        delete progressPayload.finishedAt
      } else if (!progressPayload.isFinished && this.isFinished) {
        this.finishedAt = null
        this.extraData.progress = 0
        this.currentTime = 0
        this.changed('extraData', true)
        delete progressPayload.finishedAt
        delete progressPayload.currentTime
      }
      // cast(d): isNaN coerces undefined to NaN, as in the JS
    } else if (!isNaN(progressPayload.progress as number) && progressPayload.progress !== this.progress) {
      // Old model stored progress on object
      // cast(d): progress is a number here (the isNaN check above)
      this.extraData.progress = Math.min(1, Math.max(0, progressPayload.progress as number))
      this.changed('extraData', true)
    }

    // cast(b): the payload has the attribute keys plus keys set ignores; finishedAt may be a date string, which the DATE column converts
    this.set(progressPayload as Partial<InferAttributes<MediaProgress>>)

    // Reset hideFromContinueListening if the progress has changed
    if (this.changed('currentTime') && !progressPayload.hideFromContinueListening) {
      this.hideFromContinueListening = false
    }

    const timeRemaining = this.duration - this.currentTime

    // Check if progress is far enough to mark as finished
    //   - If markAsFinishedPercentComplete is provided, use that otherwise use markAsFinishedTimeRemaining (default 10 seconds)
    let shouldMarkAsFinished = false
    if (this.duration) {
      // cast(d): isNullOrNaN is false, so markAsFinishedPercentComplete is a number
      if (!isNullOrNaN(progressPayload.markAsFinishedPercentComplete) && (progressPayload.markAsFinishedPercentComplete as number) > 0) {
        const markAsFinishedPercentComplete = Number(progressPayload.markAsFinishedPercentComplete) / 100
        shouldMarkAsFinished = markAsFinishedPercentComplete < this.progress
        if (shouldMarkAsFinished) {
          Logger.info(`[MediaProgress] Marking media progress as finished because progress (${this.progress}) is greater than ${markAsFinishedPercentComplete} (media item ${this.mediaItemId})`)
        }
      } else {
        const markAsFinishedTimeRemaining = isNullOrNaN(progressPayload.markAsFinishedTimeRemaining) ? 10 : Number(progressPayload.markAsFinishedTimeRemaining)
        shouldMarkAsFinished = timeRemaining < markAsFinishedTimeRemaining
        if (shouldMarkAsFinished) {
          Logger.info(`[MediaProgress] Marking media progress as finished because time remaining (${timeRemaining}) is less than ${markAsFinishedTimeRemaining} seconds (media item ${this.mediaItemId})`)
        }
      }
    }

    if (!this.isFinished && shouldMarkAsFinished) {
      this.isFinished = true
      this.finishedAt = this.finishedAt || Date.now()
      this.extraData.progress = 1
      this.changed('extraData', true)
    } else if (this.isFinished && this.changed('currentTime') && !shouldMarkAsFinished) {
      this.isFinished = false
      this.finishedAt = null
    }

    await this.save()

    // For local sync
    if (progressPayload.lastUpdate) {
      // cast(d): isNaN coerces the Date to its timestamp, as in the JS
      if (isNaN(new Date(progressPayload.lastUpdate) as unknown as number)) {
        Logger.warn(`[MediaProgress] Invalid date provided for lastUpdate: ${progressPayload.lastUpdate} (media item ${this.mediaItemId})`)
      } else {
        const escapedDate = this.sequelize.escape(new Date(progressPayload.lastUpdate))
        Logger.info(`[MediaProgress] Manually setting updatedAt to ${escapedDate} (media item ${this.mediaItemId})`)

        await this.sequelize.query(`UPDATE "mediaProgresses" SET "updatedAt" = ${escapedDate} WHERE "id" = '${this.id}'`)

        await this.reload()
      }
    }

    return this
  }
}

export = MediaProgress
