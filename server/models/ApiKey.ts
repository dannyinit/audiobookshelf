import { DataTypes, Model, Op, Sequelize } from 'sequelize'
import jwt = require('jsonwebtoken')
import { LRUCache } from 'lru-cache'
import Logger = require('../Logger')

interface ApiKeyPermissions {
  download: boolean
  update: boolean
  delete: boolean
  upload: boolean
  createEreader: boolean
  accessAllLibraries: boolean
  accessAllTags: boolean
  accessExplicitContent: boolean
  selectedTagsNotAccessible: boolean
  librariesAccessible: string[]
  itemTagsSelected: string[]
}

class ApiKeyCache {
  cache: LRUCache<string, ApiKey>
  constructor() {
    this.cache = new LRUCache({ max: 100 })
  }

  getById(id: string) {
    const apiKey = this.cache.get(id)
    return apiKey
  }

  set(apiKey: ApiKey) {
    apiKey.fromCache = true
    this.cache.set(apiKey.id, apiKey)
  }

  delete(apiKeyId: string) {
    this.cache.delete(apiKeyId)
  }

  maybeInvalidate(apiKey: ApiKey) {
    if (!apiKey.fromCache) this.delete(apiKey.id)
  }
}

const apiKeyCache = new ApiKeyCache()

class ApiKey extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare name: string
  /** @type {string} */
  declare description: string
  /** @type {Date} */
  declare expiresAt: Date
  /** @type {Date} */
  declare lastUsedAt: Date
  /** @type {boolean} */
  declare isActive: boolean
  /** @type {ApiKeyPermissions} */
  declare permissions: ApiKeyPermissions
  /** @type {Date} */
  declare createdAt: Date
  /** @type {Date} */
  declare updatedAt: Date
  /** @type {string} */
  declare userId: string
  /** @type {string} */
  declare createdByUserId: string
  /** @type {import('./User')} */
  declare user: import('./User')
  /** Set when the instance is stored in the api key cache */
  declare fromCache?: boolean

  /**
   * Same properties as User.getDefaultPermissions
   * @returns {ApiKeyPermissions}
   */
  static getDefaultPermissions(): ApiKeyPermissions {
    return {
      download: true,
      update: true,
      delete: true,
      upload: true,
      createEreader: true,
      accessAllLibraries: true,
      accessAllTags: true,
      accessExplicitContent: true,
      selectedTagsNotAccessible: false, // Inverts itemTagsSelected
      librariesAccessible: [],
      itemTagsSelected: []
    }
  }

  /**
   * Merge permissions from request with default permissions
   * @param {ApiKeyPermissions} reqPermissions
   * @returns {ApiKeyPermissions}
   */
  static mergePermissionsWithDefault(reqPermissions: ApiKeyPermissions): ApiKeyPermissions {
    const permissions = this.getDefaultPermissions()

    if (!reqPermissions || typeof reqPermissions !== 'object') {
      Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid permissions: ${reqPermissions}`)
      return permissions
    }

    const permissionsByKey = permissions as unknown as Record<string, unknown>
    for (const key in reqPermissions) {
      const value = (reqPermissions as unknown as Record<string, unknown>)[key]
      if (value === undefined) {
        Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid permission key: ${key}`)
        continue
      }

      if (key === 'librariesAccessible' || key === 'itemTagsSelected') {
        if (!Array.isArray(value) || value.some((value) => typeof value !== 'string')) {
          Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid ${key} value: ${value}`)
          continue
        }

        permissionsByKey[key] = value
      } else if (typeof value !== 'boolean') {
        Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid permission value for key ${key}. Should be boolean`)
        continue
      }

      permissionsByKey[key] = value
    }

    return permissions
  }

  /**
   * Deactivate expired api keys
   * @returns {Promise<number>} Number of api keys affected
   */
  static async deactivateExpiredApiKeys(): Promise<number> {
    const [affectedCount] = await ApiKey.update(
      {
        isActive: false
      },
      {
        where: {
          isActive: true,
          expiresAt: {
            [Op.lt]: new Date()
          }
        }
      }
    )
    return affectedCount
  }

  /**
   * Generate a new api key
   * @param {string} tokenSecret
   * @param {string} keyId
   * @param {string} name
   * @param {number} [expiresIn] - Seconds until the api key expires or undefined for no expiration
   * @returns {Promise<string>}
   */
  static async generateApiKey(tokenSecret: string, keyId: string, name: string, expiresIn?: number): Promise<string | null> {
    const options: { expiresIn?: number } = {}
    if (expiresIn && !isNaN(expiresIn) && expiresIn > 0) {
      options.expiresIn = expiresIn
    }

    return new Promise<string | null>((resolve) => {
      jwt.sign(
        {
          keyId,
          name,
          type: 'api'
        },
        tokenSecret,
        options,
        (err, token) => {
          if (err) {
            Logger.error(`[ApiKey] Error generating API key: ${err}`)
            resolve(null)
          } else {
            resolve(token!)
          }
        }
      )
    })
  }

  /**
   * Get an api key by id, from cache or database
   * @param {string} apiKeyId
   * @returns {Promise<ApiKey | null>}
   */
  static async getById(apiKeyId: string): Promise<ApiKey | null> {
    if (!apiKeyId) return null

    const cachedApiKey = apiKeyCache.getById(apiKeyId)
    if (cachedApiKey) return cachedApiKey

    const apiKey = await ApiKey.findByPk(apiKeyId)
    if (!apiKey) return null

    apiKeyCache.set(apiKey)
    return apiKey
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
        name: {
          type: DataTypes.STRING,
          allowNull: false
        },
        description: DataTypes.TEXT,
        expiresAt: DataTypes.DATE,
        lastUsedAt: DataTypes.DATE,
        isActive: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false
        },
        permissions: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'apiKey'
      }
    )

    const { user } = sequelize.models
    user.hasMany(ApiKey, {
      onDelete: 'CASCADE'
    })
    ApiKey.belongsTo(user)

    user.hasMany(ApiKey, {
      foreignKey: 'createdByUserId',
      onDelete: 'SET NULL'
    })
    ApiKey.belongsTo(user, { as: 'createdByUser', foreignKey: 'createdByUserId' })
  }

  async update(values: any, options?: import('sequelize').InstanceUpdateOptions): Promise<this> {
    apiKeyCache.maybeInvalidate(this)
    return await super.update(values, options)
  }

  async save(options?: import('sequelize').SaveOptions): Promise<this> {
    apiKeyCache.maybeInvalidate(this)
    return await super.save(options)
  }

  async destroy(options?: import('sequelize').InstanceDestroyOptions): Promise<void> {
    apiKeyCache.delete(this.id)
    await super.destroy(options)
  }
}

export = ApiKey
