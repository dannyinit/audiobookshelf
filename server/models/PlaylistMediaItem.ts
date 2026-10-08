import Sequelize = require('sequelize')
import type { Attributes, BelongsToGetAssociationMixin, CreationOptional, FindOptions, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import type Book = require('./Book')
import type Playlist = require('./Playlist')
import type PodcastEpisode = require('./PodcastEpisode')
import type { ModelsSequelize } from './types'
const { DataTypes, Model } = Sequelize

/**
 * dataValues of a loaded playlist media item with the included media item (moved to mediaItem by the afterFind hook)
 */
type PlaylistMediaItemDataValues = InferAttributes<PlaylistMediaItem> & {
  book?: Book
  podcastEpisode?: PodcastEpisode
  mediaItem?: Book | PodcastEpisode
}

class PlaylistMediaItem extends Model<InferAttributes<PlaylistMediaItem>, InferCreationAttributes<PlaylistMediaItem>> {
  declare id: CreationOptional<string>
  declare mediaItemId: string
  declare mediaItemType: string
  declare order: number
  declare playlistId: string
  declare createdAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize

  // Expanded properties

  /** only set when expanded */
  declare mediaItem: NonAttribute<Book | PodcastEpisode>

  // Associations: the afterFind hook moves an included book or podcastEpisode to mediaItem and deletes these

  declare book?: NonAttribute<Book>
  declare podcastEpisode?: NonAttribute<PodcastEpisode>
  declare playlist: NonAttribute<Playlist>

  declare getBook: BelongsToGetAssociationMixin<Book>
  declare getPodcastEpisode: BelongsToGetAssociationMixin<PodcastEpisode>

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
        order: DataTypes.INTEGER
      },
      {
        sequelize,
        timestamps: true,
        updatedAt: false,
        modelName: 'playlistMediaItem'
      }
    )

    const { book, podcastEpisode, playlist } = sequelize.models

    book.hasMany(PlaylistMediaItem, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'book'
      }
    })
    PlaylistMediaItem.belongsTo(book, { foreignKey: 'mediaItemId', constraints: false })

    podcastEpisode.hasOne(PlaylistMediaItem, {
      foreignKey: 'mediaItemId',
      constraints: false,
      scope: {
        mediaItemType: 'podcastEpisode'
      }
    })
    PlaylistMediaItem.belongsTo(podcastEpisode, { foreignKey: 'mediaItemId', constraints: false })

    PlaylistMediaItem.addHook('afterFind', (findResult: PlaylistMediaItem[] | PlaylistMediaItem | null) => {
      if (!findResult) return

      if (!Array.isArray(findResult)) findResult = [findResult]

      for (const instance of findResult) {
        // Same object as instance.dataValues, typed with the included rows
        const dataValues: PlaylistMediaItemDataValues = instance.dataValues
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

    playlist.hasMany(PlaylistMediaItem, {
      onDelete: 'CASCADE'
    })
    PlaylistMediaItem.belongsTo(playlist)
  }
}

namespace PlaylistMediaItem {
  export type DataValues = PlaylistMediaItemDataValues
}

export = PlaylistMediaItem
