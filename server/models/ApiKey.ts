import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, InstanceDestroyOptions, InstanceUpdateOptions, ModelAttributes, ModelStatic, NonAttribute, SaveOptions, Utils } from 'sequelize'
import jwt = require('jsonwebtoken')
import lruCache = require('lru-cache')
import Logger = require('../Logger')
import type User = require('./User')
import type { ModelsSequelize, UpdateValues } from './types'
const { LRUCache } = lruCache
const { DataTypes, Model, Op } = Sequelize

/**
 * A type alias (not an interface) so it can be read and written by key through a Record alias
 */
type ApiKeyPermissions = {
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

type ApiKeyAttributes = InferAttributes<ApiKey>

class ApiKeyCache {
  declare cache: lruCache.LRUCache<string, ApiKey>

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

class ApiKey extends Model<ApiKeyAttributes, InferCreationAttributes<ApiKey>> {
  declare id: CreationOptional<string>
  declare name: string
  declare description: string | null
  declare expiresAt: Date | null
  declare lastUsedAt: Date | null
  declare isActive: boolean
  declare permissions: ApiKeyPermissions
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
  declare userId: string
  declare createdByUserId: string | null

  /** Set on api keys held in the api key cache */
  declare fromCache?: NonAttribute<boolean>

  // Expanded properties

  declare user: NonAttribute<User>
  declare createdByUser?: NonAttribute<User>

  /**
   * Same properties as User.getDefaultPermissions
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
   */
  static mergePermissionsWithDefault(reqPermissions: ApiKeyPermissions): ApiKeyPermissions {
    const permissions = this.getDefaultPermissions()

    if (!reqPermissions || typeof reqPermissions !== 'object') {
      Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid permissions: ${reqPermissions}`)
      return permissions
    }

    // Same objects as reqPermissions and permissions, read and written by key
    const reqValues: Record<string, unknown> = reqPermissions
    const permissionValues: Record<string, unknown> = permissions
    for (const key in reqValues) {
      if (reqValues[key] === undefined) {
        Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid permission key: ${key}`)
        continue
      }

      if (key === 'librariesAccessible' || key === 'itemTagsSelected') {
        if (!Array.isArray(reqValues[key]) || reqValues[key].some((value) => typeof value !== 'string')) {
          Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid ${key} value: ${reqValues[key]}`)
          continue
        }

        permissionValues[key] = reqValues[key]
      } else if (typeof reqValues[key] !== 'boolean') {
        Logger.warn(`[ApiKey] mergePermissionsWithDefault: Invalid permission value for key ${key}. Should be boolean`)
        continue
      }

      permissionValues[key] = reqValues[key]
    }

    return permissions
  }

  /**
   * Deactivate expired api keys
   * @returns Number of api keys affected
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
   * @param [expiresIn] - Seconds until the api key expires or undefined for no expiration
   * @returns the token, or null if signing failed
   */
  static async generateApiKey(tokenSecret: string, keyId: string, name: string, expiresIn?: number): Promise<string | null | undefined> {
    const options: jwt.SignOptions = {}
    if (expiresIn && !isNaN(expiresIn) && expiresIn > 0) {
      options.expiresIn = expiresIn
    }

    return new Promise((resolve) => {
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
            resolve(token)
          }
        }
      )
    })
  }

  /**
   * Get an api key by id, from cache or database
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

  // Same overloads as Model.update
  update<K extends keyof ApiKeyAttributes>(key: K, value: ApiKeyAttributes[K] | Utils.Col | Utils.Fn | Utils.Literal, options?: InstanceUpdateOptions<ApiKeyAttributes>): Promise<this>
  update(keys: UpdateValues<ApiKeyAttributes>, options?: InstanceUpdateOptions<ApiKeyAttributes>): Promise<this>
  async update(values: keyof ApiKeyAttributes | UpdateValues<ApiKeyAttributes>, options?: InstanceUpdateOptions<ApiKeyAttributes> | ApiKeyAttributes[keyof ApiKeyAttributes] | Utils.Col | Utils.Fn | Utils.Literal): Promise<this> {
    apiKeyCache.maybeInvalidate(this)
    // cast(b) (2): the two arguments are forwarded as they came (a third update(key, value, options) argument is dropped, as in the JS); the overloads above type the callers
    return await super.update(values as UpdateValues<ApiKeyAttributes>, options as InstanceUpdateOptions<ApiKeyAttributes>)
  }

  async save(options?: SaveOptions<ApiKeyAttributes>): Promise<this> {
    apiKeyCache.maybeInvalidate(this)
    return await super.save(options)
  }

  async destroy(options?: InstanceDestroyOptions): Promise<void> {
    apiKeyCache.delete(this.id)
    await super.destroy(options)
  }
}

export = ApiKey
