import type { Response, NextFunction } from 'express'
import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import Database = require('../Database')
import type { RequestWithUser } from './types'

type ApiRouter = import('../routers/ApiRouter')
type Book = import('../models/Book')

class EmailController {
  constructor() {}

  /**
   * GET: /api/emails/settings
   */
  getSettings(req: RequestWithUser, res: Response) {
    res.json({
      settings: Database.emailSettings
    })
  }

  /**
   * PATCH: /api/emails/settings
   */
  async updateSettings(req: RequestWithUser, res: Response) {
    const updated = Database.emailSettings.update(req.body)
    if (updated) {
      await Database.updateSetting(Database.emailSettings)
    }
    res.json({
      settings: Database.emailSettings
    })
  }

  /**
   * POST: /api/emails/test
   */
  async sendTest(this: ApiRouter, req: RequestWithUser, res: Response) {
    this.emailManager.sendTest(res)
  }

  /**
   * POST: /api/emails/ereader-devices
   */
  async updateEReaderDevices(req: RequestWithUser, res: Response) {
    if (!req.body.ereaderDevices || !Array.isArray(req.body.ereaderDevices)) {
      return res.status(400).send('Invalid payload. ereaderDevices array required')
    }

    const ereaderDevices = req.body.ereaderDevices
    for (const device of ereaderDevices) {
      if (!device.name || !device.email) {
        return res.status(400).send('Invalid payload. ereaderDevices array items must have name and email')
      }
    }

    const updated = Database.emailSettings.update({
      ereaderDevices
    })
    if (updated) {
      await Database.updateSetting(Database.emailSettings)
      SocketAuthority.adminEmitter('ereader-devices-updated', {
        ereaderDevices: Database.emailSettings.ereaderDevices
      })
    }
    res.json({
      ereaderDevices: Database.emailSettings.ereaderDevices
    })
  }

  /**
   * POST: /api/emails/send-ebook-to-device
   * Send ebook to device
   * User must have access to device and library item
   */
  async sendEBookToDevice(this: ApiRouter, req: RequestWithUser, res: Response) {
    Logger.debug(`[EmailController] Send ebook to device requested by user "${req.user.username}" for libraryItemId=${req.body.libraryItemId}, deviceName=${req.body.deviceName}`)

    const device = Database.emailSettings.getEReaderDevice(req.body.deviceName)
    if (!device) {
      return res.status(404).send('Ereader device not found')
    }

    // Check user has access to device
    if (!Database.emailSettings.checkUserCanAccessDevice(device, req.user)) {
      return res.sendStatus(403)
    }

    const libraryItem = await Database.libraryItemModel.getExpandedById(req.body.libraryItemId)
    if (!libraryItem) {
      return res.status(404).send('Library item not found')
    }

    // Check user has access to library item
    if (!req.user.checkCanAccessLibraryItem(libraryItem)) {
      return res.sendStatus(403)
    }

    // cast(d): only Book media has ebookFile; for a podcast the JS reads undefined (404 below)
    const ebookFile = (libraryItem.media as Book).ebookFile
    if (!ebookFile) {
      return res.status(404).send('Ebook file not found')
    }

    this.emailManager.sendEBookToDevice(ebookFile, device, res)
  }

  adminMiddleware(req: RequestWithUser, res: Response, next: NextFunction) {
    if (!req.user.isAdminOrUp) {
      return res.sendStatus(404)
    }

    next()
  }
}
export = new EmailController()
