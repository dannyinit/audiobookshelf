import type { Response, NextFunction } from 'express'
import type { BelongsToGetAssociationMixin, CreationAttributes } from 'sequelize'
import uuid = require('uuid')
import Logger = require('../Logger')
import Database = require('../Database')
import type { RequestWithUser } from './types'

type ApiRouter = import('../routers/ApiRouter')
type ApiKey = import('../models/ApiKey')
type User = import('../models/User')

/**
 * ApiKey as used here: the model does not declare the getUser mixin of its belongsTo(User) association, and
 * dataValues.user is set to the loaded user so that toJSON includes it
 */
type ApiKeyWithUser = ApiKey & {
  getUser: BelongsToGetAssociationMixin<User>
  dataValues: ApiKey['dataValues'] & { user: User | null }
}

const uuidv4 = uuid.v4

class ApiKeyController {
  constructor() {}

  /**
   * GET: /api/api-keys
   */
  async getAll(req: RequestWithUser, res: Response) {
    const apiKeys = await Database.apiKeyModel.findAll({
      include: [
        {
          model: Database.userModel,
          attributes: ['id', 'username', 'type']
        },
        {
          model: Database.userModel,
          as: 'createdByUser',
          attributes: ['id', 'username', 'type']
        }
      ]
    })

    return res.json({
      apiKeys: apiKeys.map((a) => a.toJSON())
    })
  }

  /**
   * POST: /api/api-keys
   */
  async create(this: ApiRouter, req: RequestWithUser, res: Response) {
    if (!req.body.name || typeof req.body.name !== 'string') {
      Logger.warn(`[ApiKeyController] create: Invalid name: ${req.body.name}`)
      return res.sendStatus(400)
    }
    if (req.body.expiresIn && (typeof req.body.expiresIn !== 'number' || req.body.expiresIn <= 0)) {
      Logger.warn(`[ApiKeyController] create: Invalid expiresIn: ${req.body.expiresIn}`)
      return res.sendStatus(400)
    }
    if (!req.body.userId || typeof req.body.userId !== 'string') {
      Logger.warn(`[ApiKeyController] create: Invalid userId: ${req.body.userId}`)
      return res.sendStatus(400)
    }
    const user = await Database.userModel.getUserById(req.body.userId)
    if (!user) {
      Logger.warn(`[ApiKeyController] create: User not found: ${req.body.userId}`)
      return res.sendStatus(400)
    }
    if (user.type === 'root' && !req.user.isRoot) {
      Logger.warn(`[ApiKeyController] create: Root user API key cannot be created by non-root user`)
      return res.sendStatus(403)
    }

    const keyId = uuidv4() // Generate key id ahead of time to use in JWT
    // Non-null: the token secret is set in TokenManager.initTokenSecret when the server starts
    const apiKey = await Database.apiKeyModel.generateApiKey(this.auth.tokenManager.TokenSecret!, keyId, req.body.name, req.body.expiresIn)

    if (!apiKey) {
      Logger.error(`[ApiKeyController] create: Error generating API key`)
      return res.sendStatus(500)
    }

    // Calculate expiration time for the api key
    const expiresAt = req.body.expiresIn ? new Date(Date.now() + req.body.expiresIn * 1000) : null

    // cast(d): the ApiKey model does not declare getUser (see ApiKeyWithUser)
    const apiKeyInstance = (await Database.apiKeyModel.create(
      // NOTE: permissions is not set, so the column is null although the ApiKey model types it as required (nothing reads it at the moment)
      // cast(c): the creation values have no permissions
      {
        id: keyId,
        name: req.body.name,
        expiresAt,
        userId: req.body.userId,
        isActive: !!req.body.isActive,
        createdByUserId: req.user.id
      } as CreationAttributes<ApiKey>
    )) as ApiKeyWithUser
    apiKeyInstance.dataValues.user = await apiKeyInstance.getUser({
      attributes: ['id', 'username', 'type']
    })

    Logger.info(`[ApiKeyController] Created API key "${apiKeyInstance.name}"`)
    return res.json({
      apiKey: {
        apiKey, // Actual key only shown to user on creation
        ...apiKeyInstance.toJSON()
      }
    })
  }

  /**
   * PATCH: /api/api-keys/:id
   * Only isActive and userId can be updated because name and expiresIn are in the JWT
   */
  async update(req: RequestWithUser, res: Response) {
    // cast(d): the ApiKey model does not declare getUser (see ApiKeyWithUser)
    const apiKey = (await Database.apiKeyModel.findByPk(req.params.id, {
      include: {
        model: Database.userModel
      }
    })) as ApiKeyWithUser | null
    if (!apiKey) {
      return res.sendStatus(404)
    }
    // Only root user can update root user API keys
    if (apiKey.user.type === 'root' && !req.user.isRoot) {
      Logger.warn(`[ApiKeyController] update: Root user API key cannot be updated by non-root user`)
      return res.sendStatus(403)
    }

    let hasUpdates = false
    if (req.body.userId !== undefined) {
      if (typeof req.body.userId !== 'string') {
        Logger.warn(`[ApiKeyController] update: Invalid userId: ${req.body.userId}`)
        return res.sendStatus(400)
      }
      const user = await Database.userModel.getUserById(req.body.userId)
      if (!user) {
        Logger.warn(`[ApiKeyController] update: User not found: ${req.body.userId}`)
        return res.sendStatus(400)
      }
      if (user.type === 'root' && !req.user.isRoot) {
        Logger.warn(`[ApiKeyController] update: Root user API key cannot be created by non-root user`)
        return res.sendStatus(403)
      }
      if (apiKey.userId !== req.body.userId) {
        apiKey.userId = req.body.userId
        hasUpdates = true
      }
    }

    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== 'boolean') {
        return res.sendStatus(400)
      }
      if (apiKey.isActive !== req.body.isActive) {
        apiKey.isActive = req.body.isActive
        hasUpdates = true
      }
    }

    if (hasUpdates) {
      await apiKey.save()
      apiKey.dataValues.user = await apiKey.getUser({
        attributes: ['id', 'username', 'type']
      })
      Logger.info(`[ApiKeyController] Updated API key "${apiKey.name}"`)
    } else {
      Logger.info(`[ApiKeyController] No updates needed to API key "${apiKey.name}"`)
    }

    return res.json({
      apiKey: apiKey.toJSON()
    })
  }

  /**
   * DELETE: /api/api-keys/:id
   */
  async delete(req: RequestWithUser, res: Response) {
    const apiKey = await Database.apiKeyModel.findByPk(req.params.id)
    if (!apiKey) {
      return res.sendStatus(404)
    }

    await apiKey.destroy()
    Logger.info(`[ApiKeyController] Deleted API key "${apiKey.name}"`)

    return res.sendStatus(200)
  }

  middleware(req: RequestWithUser, res: Response, next: NextFunction) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`[ApiKeyController] Non-admin user "${req.user.username}" attempting to access api keys`)
      return res.sendStatus(403)
    }

    next()
  }
}

export = new ApiKeyController()
