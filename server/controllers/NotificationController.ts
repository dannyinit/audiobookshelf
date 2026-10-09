import type { Response, NextFunction } from 'express'
import Database = require('../Database')
import packageJson = require('../../package.json')
import NotificationManager = require('../managers/NotificationManager')
import type { RequestWithUser } from './types'

type Notification = import('../objects/Notification')

const { version } = packageJson

type NotificationRequest = RequestWithUser & { notification: Notification }

class NotificationController {
  constructor() {}

  /**
   * GET: /api/notifications
   * Get notifications, settings and data
   */
  get(req: RequestWithUser, res: Response) {
    res.json({
      data: NotificationManager.getData(),
      settings: Database.notificationSettings
    })
  }

  /**
   * PATCH: /api/notifications
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
   */
  getData(req: RequestWithUser, res: Response) {
    res.json(NotificationManager.getData())
  }

  /**
   * GET: /api/notifications/test
   */
  async fireTestEvent(req: RequestWithUser, res: Response) {
    await NotificationManager.triggerNotification('onTest', { version: `v${version}` }, req.query.fail === '1')
    res.sendStatus(200)
  }

  /**
   * POST: /api/notifications
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
   */
  async deleteNotification(req: NotificationRequest, res: Response) {
    // Non-null: the middleware found this notification by its id
    if (Database.notificationSettings.removeNotification(req.notification.id!)) {
      await Database.updateSetting(Database.notificationSettings)
    }
    res.json(Database.notificationSettings)
  }

  /**
   * PATCH: /api/notifications/:id
   */
  async updateNotification(req: NotificationRequest, res: Response) {
    const success = Database.notificationSettings.updateNotification(req.body)
    if (success) {
      await Database.updateSetting(Database.notificationSettings)
    }
    res.json(Database.notificationSettings)
  }

  /**
   * GET: /api/notifications/:id/test
   */
  async sendNotificationTest(req: NotificationRequest, res: Response) {
    if (!Database.notificationSettings.isUseable) return res.status(400).send('Apprise is not configured')

    const success = await NotificationManager.sendTestNotification(req.notification)
    if (success) res.sendStatus(200)
    else res.sendStatus(500)
  }

  /**
   * Requires admin or up
   */
  middleware(req: RequestWithUser & { notification?: Notification }, res: Response, next: NextFunction) {
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
