import { DataTypes, Model } from 'sequelize'

/**
 * @typedef MediaItemShareObject
 * @property {string} id
 * @property {string} mediaItemId
 * @property {string} mediaItemType
 * @property {string} slug
 * @property {string} pash
 * @property {string} userId
 * @property {Date} expiresAt
 * @property {Object} extraData
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {boolean} isDownloadable
 *
 * @typedef {MediaItemShareObject & MediaItemShare} MediaItemShareModel
 */

/**
 * @typedef MediaItemShareForClient
 * @property {string} id
 * @property {string} mediaItemId
 * @property {string} mediaItemType
 * @property {string} slug
 * @property {Date} expiresAt
 * @property {Date} createdAt
 * @property {Date} updatedAt
 * @property {boolean} isDownloadable
 */

class MediaItemShare extends Model {
  /** @type {string} */
  declare id
  /** @type {string} */
  declare mediaItemId
  /** @type {string} */
  declare mediaItemType
  /** @type {string} */
  declare slug
  /** @type {string} */
  declare pash
  /** @type {string} */
  declare userId
  /** @type {Date} */
  declare expiresAt
  /** @type {Object} */
  declare extraData
  /** @type {Date} */
  declare createdAt
  /** @type {Date} */
  declare updatedAt
  /** @type {boolean} */
  declare isDownloadable
  /** @type {import('./Book')|import('./PodcastEpisode')} */
  declare mediaItem

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
  static async getMediaItemsLibraryItem(mediaItemId, mediaItemType) {
    /** @type {typeof import('./LibraryItem')} */
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

  /**
   *
   * @param {import('sequelize').FindOptions} options
   * @returns {Promise<import('./Book')|import('./PodcastEpisode')>}
   */
  getMediaItem(options) {
    if (!this.mediaItemType) return Promise.resolve(null)
    const mixinMethodName = `get${this.sequelize.uppercaseFirst(this.mediaItemType)}`
    return this[mixinMethodName](options)
  }

  /**
   * Initialize model
   *
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
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
