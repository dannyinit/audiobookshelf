import Sequelize = require('sequelize')
import type { Attributes, BelongsToGetAssociationMixin, CreationOptional, FindOptions, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import type Book = require('./Book')
import type PodcastEpisode = require('./PodcastEpisode')
import type User = require('./User')
import type { ModelsSequelize } from './types'
const { DataTypes, Model } = Sequelize

/**
 * dataValues of a loaded share with the included media item (moved to mediaItem by the afterFind hook)
 */
type MediaItemShareDataValues = InferAttributes<MediaItemShare> & {
  book?: Book
  podcastEpisode?: PodcastEpisode
  mediaItem?: Book | PodcastEpisode
}

class MediaItemShare extends Model<InferAttributes<MediaItemShare>, InferCreationAttributes<MediaItemShare>> {
  declare id: CreationOptional<string>
  declare mediaItemId: string
  declare mediaItemType: string
  declare slug: string
  declare pash: string
  declare userId: string
  declare expiresAt: Date
  declare extraData: object | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
  declare isDownloadable: boolean

  declare sequelize: ModelsSequelize
  declare static readonly sequelize: ModelsSequelize

  // Expanded properties

  declare mediaItem: NonAttribute<Book | PodcastEpisode>

  // Associations: the afterFind hook moves an included book or podcastEpisode to mediaItem and deletes these

  declare book?: NonAttribute<Book>
  declare podcastEpisode?: NonAttribute<PodcastEpisode>
  declare user?: NonAttribute<User>

  declare getBook: BelongsToGetAssociationMixin<Book>
  declare getPodcastEpisode: BelongsToGetAssociationMixin<PodcastEpisode>

  toJSONForClient(): MediaItemShare.MediaItemShareForClient {
    return {
      id: this.id,
      mediaItemId: this.mediaItemId,
      mediaItemType: this.mediaItemType,
      slug: this.slug,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      isDownloadable: this.isDownloadable
    }
  }

  /**
   * Expanded book that includes library settings
   */
  static async getMediaItemsLibraryItem(mediaItemId: string, mediaItemType: string) {
    const libraryItemModel = this.sequelize.models.libraryItem

    if (mediaItemType === 'book') {
      const libraryItem = await libraryItemModel.findOneExpanded({ mediaId: mediaItemId }, null, {
        model: this.sequelize.models.library,
        attributes: ['settings']
      })

      return libraryItem
    }
    return null
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
        slug: DataTypes.STRING,
        pash: DataTypes.STRING,
        expiresAt: DataTypes.DATE,
        extraData: DataTypes.JSON,
        isDownloadable: DataTypes.BOOLEAN
      },
      {
        sequelize,
        modelName: 'mediaItemShare'
      }
    )

    const { user, book, podcastEpisode } = sequelize.models

    user.hasMany(MediaItemShare)
    MediaItemShare.belongsTo(user)

    book.hasMany(MediaItemShare, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'book'
      }
    })
    MediaItemShare.belongsTo(book, { foreignKey: 'mediaItemId', constraints: false })

    podcastEpisode.hasOne(MediaItemShare, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'podcastEpisode'
      }
    })
    MediaItemShare.belongsTo(podcastEpisode, { foreignKey: 'mediaItemId', constraints: false })

    MediaItemShare.addHook('afterFind', (findResult: MediaItemShare[] | MediaItemShare | null) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]

      for (const instance of findResult) {
        // Same object as instance.dataValues, typed with the included rows
        const dataValues: MediaItemShareDataValues = instance.dataValues
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

namespace MediaItemShare {
  export interface MediaItemShareObject {
    id: string
    mediaItemId: string
    mediaItemType: string
    slug: string
    pash: string
    userId: string
    expiresAt: Date
    extraData: object | null
    createdAt: Date
    updatedAt: Date
    isDownloadable: boolean
  }

  export interface MediaItemShareForClient {
    id: string
    mediaItemId: string
    mediaItemType: string
    slug: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
    isDownloadable: boolean
  }

  export type MediaItemShareModel = MediaItemShareObject & MediaItemShare
}

export = MediaItemShare
