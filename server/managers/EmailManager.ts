import nodemailer = require('nodemailer')
import Database = require('../Database')
import Logger = require("../Logger")
import type { Response } from 'express'
import type SMTPTransport = require('nodemailer/lib/smtp-transport')
import type Mail = require('nodemailer/lib/mailer')
import type EmailSettings = require('../objects/settings/EmailSettings')
import type { EBookFileObject } from '../models/types'

/**
 * Ereader device from the email settings
 */
type EreaderDevice = EmailSettings['ereaderDevices'][number]

class EmailManager {
  constructor() { }

  getTransporter() {
    // cast(d): the settings keep a null host and pass when they are not set; nodemailer types them as optional strings
    return nodemailer.createTransport(Database.emailSettings.getTransportObject() as SMTPTransport.Options)
  }

  async sendTest(res: Response) {
    Logger.info(`[EmailManager] Sending test email`)
    const transporter = this.getTransporter()

    const success = await transporter.verify().catch((error: Error) => {
      Logger.error(`[EmailManager] Failed to verify SMTP connection config`, error)
      return false
    })

    if (!success) {
      return res.status(400).send('Failed to verify SMTP connection configuration')
    }

    // cast(d): the from and to addresses are null when not set; nodemailer types them as optional, the null is passed on as in the JS
    transporter.sendMail({
      from: Database.emailSettings.fromAddress,
      to: Database.emailSettings.testAddress || Database.emailSettings.fromAddress,
      subject: 'Test email from Audiobookshelf',
      text: 'Success!'
    } as Mail.Options).then((result) => {
      Logger.info(`[EmailManager] Test email sent successfully`, result)
      res.sendStatus(200)
    }).catch((error: Error) => {
      Logger.error(`[EmailManager] Failed to send test email`, error)
      res.status(400).send(error.message || 'Failed to send test email')
    })
  }

  async sendEBookToDevice(ebookFile: EBookFileObject, device: EreaderDevice, res: Response) {
    Logger.info(`[EmailManager] Sending ebook "${ebookFile.metadata.filename}" to device "${device.name}"/"${device.email}"`)
    const transporter = this.getTransporter()

    const success = await transporter.verify().catch((error: Error) => {
      Logger.error(`[EmailManager] Failed to verify SMTP connection config`, error)
      return false
    })

    if (!success) {
      return res.status(400).send('Failed to verify SMTP connection configuration')
    }

    // cast(d): the from address is null when not set; nodemailer types it as optional, the null is passed on as in the JS
    transporter.sendMail({
      from: Database.emailSettings.fromAddress,
      to: device.email,
      subject: "Here is your Ebook!",
      html: '<div dir="auto"></div>',
      attachments: [
        {
          filename: ebookFile.metadata.filename,
          path: ebookFile.metadata.path,
        }
      ]
    } as Mail.Options).then((result) => {
      Logger.info(`[EmailManager] Ebook sent to device successfully`, result)
      res.sendStatus(200)
    }).catch((error: Error) => {
      Logger.error(`[EmailManager] Failed to send ebook to device`, error)
      res.status(400).send(error.message || 'Failed to send ebook to device')
    })
  }
}
export = EmailManager
