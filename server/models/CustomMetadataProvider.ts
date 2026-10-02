import { DataTypes, Model } from 'sequelize'

/**
 * @typedef ClientCustomMetadataProvider
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {string} slug
 */

class CustomMetadataProvider extends Model {
  /** @type {string} */
  declare id
  /** @type {string} */
  declare mediaType
  /** @type {string} */
  declare name
  /** @type {string} */
  declare url
  /** @type {string} */
  declare authHeaderValue
  /** @type {Object} */
  declare extraData
  /** @type {Date} */
  declare createdAt
  /** @type {Date} */
  declare updatedAt

  constructor(values, options) {
    super(values, options)

  }

  /**
   * Get providers for client by media type
   * Currently only available for "book" media type
   *
   * @param {string} mediaType
   * @returns {Promise<ClientCustomMetadataProvider[]>}
   */
  static async getForClientByMediaType(mediaType) {
    if (mediaType !== 'book') return []
    const customMetadataProviders = await this.findAll({
      where: {
        mediaType
      }
    })
    return customMetadataProviders.map((cmp) => cmp.toClientJson())
  }

  /**
   * Check if provider exists by slug
   *
   * @param {string} providerSlug
   * @returns {Promise<boolean>}
   */
  static async checkExistsBySlug(providerSlug) {
    const providerId = providerSlug?.split?.('custom-')[1]
    if (!providerId) return false

    return (await this.count({ where: { id: providerId } })) > 0
  }

  /**
   * Initialize model
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
        name: DataTypes.STRING,
        mediaType: DataTypes.STRING,
        url: DataTypes.STRING,
        authHeaderValue: DataTypes.STRING,
        extraData: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'customMetadataProvider'
      }
    )
  }

  getSlug() {
    return `custom-${this.id}`
  }

  /**
   * Safe for clients
   * @returns {ClientCustomMetadataProvider}
   */
  toClientJson() {
    return {
      id: this.id,
      name: this.name,
      mediaType: this.mediaType,
      slug: this.getSlug()
    }
  }
}

export = CustomMetadataProvider
