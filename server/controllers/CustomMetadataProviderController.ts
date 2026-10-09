import type { Response, NextFunction } from 'express'
import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import Database = require('../Database')

import utils = require('../utils/index')
import type { RequestWithUser } from './types'

type CustomMetadataProvider = import('../models/CustomMetadataProvider')

const { validateUrl } = utils

class CustomMetadataProviderController {
  constructor() {}

  /**
   * GET: /api/custom-metadata-providers
   */
  async getAll(req: RequestWithUser, res: Response) {
    const providers = await Database.customMetadataProviderModel.findAll()

    res.json({
      providers
    })
  }

  /**
   * POST: /api/custom-metadata-providers
   */
  async create(req: RequestWithUser, res: Response) {
    const { name, url, mediaType, authHeaderValue } = req.body

    if (!name || !url || !mediaType) {
      return res.status(400).send('Invalid request body')
    }

    const validUrl = validateUrl(url)
    if (!validUrl) {
      Logger.error(`[CustomMetadataProviderController] Invalid url "${url}"`)
      return res.status(400).send('Invalid url')
    }

    const provider = await Database.customMetadataProviderModel.create({
      name,
      mediaType,
      url,
      authHeaderValue: !authHeaderValue ? null : authHeaderValue
    })

    // TODO: Necessary to emit to all clients?
    SocketAuthority.emitter('custom_metadata_provider_added', provider.toClientJson())

    res.json({
      provider
    })
  }

  /**
   * DELETE: /api/custom-metadata-providers/:id
   */
  async delete(req: RequestWithUser & { customMetadataProvider: CustomMetadataProvider }, res: Response) {
    const slug = `custom-${req.params.id}`

    const provider = req.customMetadataProvider
    const providerClientJson = provider.toClientJson()

    const fallbackProvider = provider.mediaType === 'book' ? 'google' : 'itunes'

    await provider.destroy()

    // Libraries using this provider fallback to default provider
    await Database.libraryModel.update(
      {
        provider: fallbackProvider
      },
      {
        where: {
          provider: slug
        }
      }
    )

    // TODO: Necessary to emit to all clients?
    SocketAuthority.emitter('custom_metadata_provider_removed', providerClientJson)

    res.sendStatus(200)
  }

  /**
   * Middleware that requires admin or up
   */
  async middleware(req: RequestWithUser & { customMetadataProvider?: CustomMetadataProvider | null }, res: Response, next: NextFunction) {
    if (!req.user.isAdminOrUp) {
      Logger.warn(`[CustomMetadataProviderController] Non-admin user "${req.user.username}" attempted access route "${req.path}"`)
      return res.sendStatus(403)
    }

    // If id param then add req.customMetadataProvider
    if (req.params.id) {
      req.customMetadataProvider = await Database.customMetadataProviderModel.findByPk(req.params.id)
      if (!req.customMetadataProvider) {
        return res.sendStatus(404)
      }
    }

    next()
  }
}
export = new CustomMetadataProviderController()
