import { Request, Response, NextFunction } from 'express'
import Database = require('../Database')
import { version } from '../../package.json'
import NotificationManager = require('../managers/NotificationManager')

interface RequestUserObject {
  user: import('../models/User')
}

type RequestWithUser = Request & RequestUserObject

class NotificationController {
  constructor() {}

  /**
   * GET: /api/notifications
   * Get notifications, settings and data
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  get(req: RequestWithUser, res: Response) {
    res.json({
      data: NotificationManager.getData(),
      settings: Database.notificationSettings
    })
  }

  /**
   * PATCH: /api/notifications
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async update(req: RequestWithUser, res: Response) {
    const updated = Database.notificationSettings.update(req.body)
    if (updated) {
      await Database.updateSetting(Database.notificationSettings)
    }
    res.sendStatus(200)
  }

  /**
   * GET: /api/notificationdata
   * @deprecated Use /api/notifications
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  getData(req: RequestWithUser, res: Response) {
    res.json(NotificationManager.getData())
  }

  /**
   * GET: /api/notifications/test
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async fireTestEvent(req: RequestWithUser, res: Response) {
    await NotificationManager.triggerNotification('onTest', { version: `v${version}` }, req.query.fail === '1')
    res.sendStatus(200)
  }

  /**
   * POST: /api/notifications
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async createNotification(req: RequestWithUser, res: Response) {
    const success = Database.notificationSettings.createNotification(req.body)

    if (success) {
      await Database.updateSetting(Database.notificationSettings)
    }
    res.json(Database.notificationSettings)
  }

  /**
   * DELETE: /api/notifications/:id
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async deleteNotification(req: RequestWithUser, res: Response) {
    if (Database.notificationSettings.removeNotification(req.notification.id)) {
      await Database.updateSetting(Database.notificationSettings)
    }
    res.json(Database.notificationSettings)
  }

  /**
   * PATCH: /api/notifications/:id
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async updateNotification(req: RequestWithUser, res: Response) {
    const success = Database.notificationSettings.updateNotification(req.body)
    if (success) {
      await Database.updateSetting(Database.notificationSettings)
    }
    res.json(Database.notificationSettings)
  }

  /**
   * GET: /api/notifications/:id/test
   *
   * @this {import('../routers/ApiRouter')}
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async sendNotificationTest(req: RequestWithUser, res: Response) {
    if (!Database.notificationSettings.isUseable) return res.status(400).send('Apprise is not configured')

    const success = await NotificationManager.sendTestNotification(req.notification)
    if (success) res.sendStatus(200)
    else res.sendStatus(500)
  }

  /**
   * Requires admin or up
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   * @param {NextFunction} next
   */
  middleware(req: RequestWithUser, res: Response, next: NextFunction) {
    if (!req.user.isAdminOrUp) {
      return res.sendStatus(403)
    }

    if (req.params.id) {
      const notification = Database.notificationSettings.getNotification(req.params.id)
      if (!notification) {
        return res.sendStatus(404)
      }
      req.notification = notification
    }

    next()
  }
}
export = new NotificationController()
