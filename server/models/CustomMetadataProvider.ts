import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic } from 'sequelize'
import type { ModelsSequelize } from './types'
const { DataTypes, Model } = Sequelize

interface ClientCustomMetadataProvider {
  id: string
  name: string
  /** Only "book" at the moment */
  mediaType: string
  slug: string
}

class CustomMetadataProvider extends Model<InferAttributes<CustomMetadataProvider>, InferCreationAttributes<CustomMetadataProvider>> {
  declare id: CreationOptional<string>
  declare mediaType: string
  declare name: string
  declare url: string
  declare authHeaderValue: string | null
  declare extraData: object | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  /**
   * Get providers for client by media type
   * Currently only available for "book" media type
   */
  static async getForClientByMediaType(mediaType: string): Promise<ClientCustomMetadataProvider[]> {
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
   */
  static async checkExistsBySlug(providerSlug: string): Promise<boolean> {
    const providerId = providerSlug?.split?.('custom-')[1]
    if (!providerId) return false

    return (await this.count({ where: { id: providerId } })) > 0
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
   */
  toClientJson(): ClientCustomMetadataProvider {
    return {
      id: this.id,
      name: this.name,
      mediaType: this.mediaType,
      slug: this.getSlug()
    }
  }
}

export = CustomMetadataProvider
