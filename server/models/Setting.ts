import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic } from 'sequelize'
import oldEmailSettings = require('../objects/settings/EmailSettings')
import oldServerSettings = require('../objects/settings/ServerSettings')
import oldNotificationSettings = require('../objects/settings/NotificationSettings')
import type { ModelsSequelize } from './types'
const { DataTypes, Model } = Sequelize

// Stored settings JSON: the input of each settings constructor, with the id of the setting
type EmailSettingsJSON = NonNullable<ConstructorParameters<typeof oldEmailSettings>[0]> & { id: string }
type ServerSettingsJSON = NonNullable<ConstructorParameters<typeof oldServerSettings>[0]> & { id: string }
type NotificationSettingsJSON = NonNullable<ConstructorParameters<typeof oldNotificationSettings>[0]> & { id: string }

/**
 * Setting value JSON column: the JSON of one of the settings objects (the key is its id)
 */
type SettingValue = EmailSettingsJSON | ServerSettingsJSON | NotificationSettingsJSON

class Setting extends Model<InferAttributes<Setting>, InferCreationAttributes<Setting>> {
  declare key: string
  declare value: SettingValue
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  static async getOldSettings() {
    const settings = (await this.findAll()).map((se) => se.value)

    const emailSettingsJson = settings.find((se): se is EmailSettingsJSON => se.id === 'email-settings')
    const serverSettingsJson = settings.find((se): se is ServerSettingsJSON => se.id === 'server-settings')
    const notificationSettingsJson = settings.find((se): se is NotificationSettingsJSON => se.id === 'notification-settings')

    return {
      settings,
      emailSettings: new oldEmailSettings(emailSettingsJson),
      serverSettings: new oldServerSettings(serverSettingsJson),
      notificationSettings: new oldNotificationSettings(notificationSettingsJson)
    }
  }

  /**
   * The settings object is stored as is; the JSON column serializes it with its toJSON
   */
  static updateSettingObj(setting: oldEmailSettings | oldServerSettings | oldNotificationSettings) {
    return this.upsert({
      key: setting.id,
      value: setting
    })
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
