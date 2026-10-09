import type { Response } from 'express'
import CacheManager = require('../managers/CacheManager')
import type { RequestWithUser } from './types'

class CacheController {
  constructor() {}

  /**
   * POST: /api/cache/purge
   */
  async purgeCache(req: RequestWithUser, res: Response) {
    if (!req.user.isAdminOrUp) {
      return res.sendStatus(403)
    }
    await CacheManager.purgeAll()
    res.sendStatus(200)
  }

  /**
   * POST: /api/cache/items/purge
   */
  async purgeItemsCache(req: RequestWithUser, res: Response) {
    if (!req.user.isAdminOrUp) {
      return res.sendStatus(403)
    }
    await CacheManager.purgeItems()
    res.sendStatus(200)
  }
}
export = new CacheController()
