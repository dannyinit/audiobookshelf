import { DataTypes, Model } from 'sequelize'

interface MediaItemShareObject {
  id: string
  mediaItemId: string
  mediaItemType: string
  slug: string
  pash: string
  userId: string
  expiresAt: Date
  extraData: Object
  createdAt: Date
  updatedAt: Date
  isDownloadable: boolean
}

type MediaItemShareModel = MediaItemShareObject & MediaItemShare

interface MediaItemShareForClient {
  id: string
  mediaItemId: string
  mediaItemType: string
  slug: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  isDownloadable: boolean
}

class MediaItemShare extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare mediaItemId: string
  /** @type {string} */
  declare mediaItemType: string
  /** @type {string} */
  declare slug: string
  /** @type {string} */
  declare pash: string
  /** @type {string} */
  declare userId: string
  /** @type {Date} */
  declare expiresAt: Date
  /** @type {Object} */
  declare extraData: object
  /** @type {Date} */
  declare createdAt: Date
  /** @type {Date} */
  declare updatedAt: Date
  /** @type {boolean} */
  declare isDownloadable: boolean
  /** @type {import('./Book')|import('./PodcastEpisode')} */
  declare mediaItem: import('./Book') | import('./PodcastEpisode')

  constructor(values, options) {
    super(values, options)


    // Expanded properties

  }

  toJSONForClient() {
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
   *
   * @param {string} mediaItemId
   * @param {string} mediaItemType
   * @returns {Promise<import('./LibraryItem').LibraryItemExpanded>}
   */
  static async getMediaItemsLibraryItem(mediaItemId: string, mediaItemType: string): Promise<import('./LibraryItem').LibraryItemExpanded> {
    /** @type {typeof import('./LibraryItem')} */
    const libraryItemModel: typeof import('./LibraryItem') = this.sequelize.models.libraryItem

    if (mediaItemType === 'book') {
      const libraryItem = await libraryItemModel.findOneExpanded({ mediaId: mediaItemId }, null, {
        model: this.sequelize.models.library,
        attributes: ['settings']
      })

      return libraryItem
    }
    return null
  }

  /**
   *
   * @param {import('sequelize').FindOptions} options
   * @returns {Promise<import('./Book')|import('./PodcastEpisode')>}
   */
  getMediaItem(options: import('sequelize').FindOptions): Promise<import('./Book') | import('./PodcastEpisode')> {
    if (!this.mediaItemType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.mediaItemType)}`
    return this[mixinMethodName](options)
  }

  /**
   * Initialize model
   *
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize: import('../Database').sequelize) {
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

    MediaItemShare.addHook('afterFind', (findResult) => {
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

export = MediaItemShare
