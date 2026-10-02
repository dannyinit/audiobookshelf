import { DataTypes, Model } from 'sequelize'

import oldEmailSettings = require('../objects/settings/EmailSettings')
import oldServerSettings = require('../objects/settings/ServerSettings')
import oldNotificationSettings = require('../objects/settings/NotificationSettings')

class Setting extends Model {
  /** @type {string} */
  declare key: string
  /** @type {Object} */
  declare value: object
  /** @type {Date} */
  declare createdAt: Date
  /** @type {Date} */
  declare updatedAt: Date

  constructor(values, options) {
    super(values, options)

  }

  static async getOldSettings() {
    const settings = (await this.findAll()).map((se) => se.value)

    const emailSettingsJson = settings.find((se) => se.id === 'email-settings')
    const serverSettingsJson = settings.find((se) => se.id === 'server-settings')
    const notificationSettingsJson = settings.find((se) => se.id === 'notification-settings')

    return {
      settings,
      emailSettings: new oldEmailSettings(emailSettingsJson),
      serverSettings: new oldServerSettings(serverSettingsJson),
      notificationSettings: new oldNotificationSettings(notificationSettingsJson)
    }
  }

  static updateSettingObj(setting) {
    return this.upsert({
      key: setting.id,
      value: setting
    })
  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize: import('../Database').sequelize) {
    super.init(
      {
        key: {
          type: DataTypes.STRING,
          primaryKey: true
        },
        value: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'setting'
      }
    )
  }
}

export = Setting
