import { DataTypes, Model, Sequelize, FindOptions, BelongsToGetAssociationMixin } from 'sequelize'

type Book = import('./Book')
type PodcastEpisode = import('./PodcastEpisode')

class PlaylistMediaItem extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare mediaItemId: string
  /** @type {string} */
  declare mediaItemType: string
  /** @type {number} */
  declare order: number
  /** @type {string} */
  declare playlistId: string
  /** only set when included */
  declare playlist?: import('./Playlist')
  /** @type {Date} */
  declare createdAt: Date
  /** only set when expanded */
  declare mediaItem: Book | PodcastEpisode
  // Polymorphic association includes, moved to mediaItem by the afterFind hook
  declare book?: Book
  declare podcastEpisode?: PodcastEpisode

  declare getBook: BelongsToGetAssociationMixin<Book>
  declare getPodcastEpisode: BelongsToGetAssociationMixin<PodcastEpisode>

  getMediaItem(options?: FindOptions): Promise<Book | PodcastEpisode | null> {
    if (!this.mediaItemType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.mediaItemType)}` as 'getBook' | 'getPodcastEpisode'
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

    PlaylistMediaItem.addHook('afterFind', (findResult) => {
      if (!findResult) return

      const instances = (Array.isArray(findResult) ? findResult : [findResult]) as PlaylistMediaItem[]

      for (const instance of instances) {
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

    playlist.hasMany(PlaylistMediaItem, {
      onDelete: 'CASCADE'
    })
    PlaylistMediaItem.belongsTo(playlist)
  }
}

export = PlaylistMediaItem
