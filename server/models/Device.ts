import { DataTypes, Model, Sequelize } from 'sequelize'
import oldDevice = require('../objects/DeviceInfo')

class Device extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare deviceId: string
  /** @type {string} */
  declare clientName: string
  /** @type {string} */
  declare clientVersion: string
  /** @type {string} */
  declare ipAddress: string
  /** @type {string} */
  declare deviceName: string
  /** @type {string} */
  declare deviceVersion: string
  /** @type {object} */
  declare extraData: Record<string, any>
  /** @type {string} */
  declare userId: string
  /** @type {Date} */
  declare createdAt: Date
  /** @type {Date} */
  declare updatedAt: Date

  static async getOldDeviceByDeviceId(deviceId: string) {
    const device = await this.findOne({
      where: {
        deviceId
      }
    })
    if (!device) return null
    return device.getOldDevice()
  }

  static createFromOld(oldDevice: import('../objects/DeviceInfo')) {
    const device = this.getFromOld(oldDevice)
    return this.create(device)
  }

  static updateFromOld(oldDevice: import('../objects/DeviceInfo')) {
    const device = this.getFromOld(oldDevice)
    return this.update(device, {
      where: {
        id: device.id
      }
    })
  }

  static getFromOld(oldDeviceInfo: import('../objects/DeviceInfo')) {
    let extraData: Record<string, string> = {}

    if (oldDeviceInfo.manufacturer) {
      extraData.manufacturer = oldDeviceInfo.manufacturer
    }
    if (oldDeviceInfo.model) {
      extraData.model = oldDeviceInfo.model
    }
    if (oldDeviceInfo.osName) {
      extraData.osName = oldDeviceInfo.osName
    }
    if (oldDeviceInfo.osVersion) {
      extraData.osVersion = oldDeviceInfo.osVersion
    }
    if (oldDeviceInfo.browserName) {
      extraData.browserName = oldDeviceInfo.browserName
    }

    return {
      id: oldDeviceInfo.id,
      deviceId: oldDeviceInfo.deviceId,
      clientName: oldDeviceInfo.clientName || null,
      clientVersion: oldDeviceInfo.clientVersion || null,
      ipAddress: oldDeviceInfo.ipAddress,
      deviceName: oldDeviceInfo.deviceName || null,
      deviceVersion: oldDeviceInfo.sdkVersion || oldDeviceInfo.browserVersion || null,
      userId: oldDeviceInfo.userId,
      extraData
    }
  }

  /**
   * Initialize model
   * @param sequelize
   */
  static initModel(sequelize: Sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        deviceId: DataTypes.STRING,
        clientName: DataTypes.STRING, // e.g. Abs Web, Abs Android
        clientVersion: DataTypes.STRING, // e.g. Server version or mobile version
        ipAddress: DataTypes.STRING,
        deviceName: DataTypes.STRING, // e.g. Windows 10 Chrome, Google Pixel 6, Apple iPhone 10,3
        deviceVersion: DataTypes.STRING, // e.g. Browser version or Android SDK
        extraData: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'device'
      }
    )

    const { user } = sequelize.models

    user.hasMany(Device, {
      onDelete: 'CASCADE'
    })
    Device.belongsTo(user)
  }

  toOldJSON() {
    let browserVersion = null
    let sdkVersion = null
    if (this.clientName === 'Abs Android') {
      sdkVersion = this.deviceVersion || null
    } else {
      browserVersion = this.deviceVersion || null
    }

    return {
      id: this.id,
      deviceId: this.deviceId,
      userId: this.userId,
      ipAddress: this.ipAddress,
      browserName: this.extraData.browserName || null,
      browserVersion,
      osName: this.extraData.osName || null,
      osVersion: this.extraData.osVersion || null,
      clientVersion: this.clientVersion || null,
      manufacturer: this.extraData.manufacturer || null,
      model: this.extraData.model || null,
      sdkVersion,
      deviceName: this.deviceName,
      clientName: this.clientName
    }
  }

  getOldDevice() {
    let browserVersion = null
    let sdkVersion = null
    if (this.clientName === 'Abs Android') {
      sdkVersion = this.deviceVersion || null
    } else {
      browserVersion = this.deviceVersion || null
    }

    return new oldDevice({
      id: this.id,
      deviceId: this.deviceId,
      userId: this.userId,
      ipAddress: this.ipAddress,
      browserName: this.extraData.browserName || null,
      browserVersion,
      osName: this.extraData.osName || null,
      osVersion: this.extraData.osVersion || null,
      clientVersion: this.clientVersion || null,
      manufacturer: this.extraData.manufacturer || null,
      model: this.extraData.model || null,
      sdkVersion,
      deviceName: this.deviceName,
      clientName: this.clientName
    })
  }
}

export = Device
