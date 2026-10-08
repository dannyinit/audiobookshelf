import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import oldDevice = require('../objects/DeviceInfo')
import type User = require('./User')
import type { DeviceExtraData, ModelsSequelize } from './types'
const { DataTypes, Model } = Sequelize

/**
 * Old device info (objects/DeviceInfo) as passed to createFromOld/updateFromOld, which is stored with its id set
 */
type OldDeviceInfo = Omit<oldDevice, 'id'> & { id: string }

class Device extends Model<InferAttributes<Device>, InferCreationAttributes<Device>> {
  declare id: CreationOptional<string>
  declare deviceId: string | null
  declare clientName: string | null
  declare clientVersion: string | null
  declare ipAddress: string | null
  declare deviceName: string | null
  declare deviceVersion: string | null
  declare extraData: DeviceExtraData
  declare userId: string | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  // Associations, only set when included

  declare user?: NonAttribute<User>

  static async getOldDeviceByDeviceId(deviceId: string) {
    const device = await this.findOne({
      where: {
        deviceId
      }
    })
    if (!device) return null
    return device.getOldDevice()
  }

  static createFromOld(oldDevice: OldDeviceInfo) {
    const device = this.getFromOld(oldDevice)
    return this.create(device)
  }

  static updateFromOld(oldDevice: OldDeviceInfo) {
    const device = this.getFromOld(oldDevice)
    return this.update(device, {
      where: {
        id: device.id
      }
    })
  }

  static getFromOld(oldDeviceInfo: OldDeviceInfo) {
    let extraData: DeviceExtraData = {}

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
   */
  static init(sequelize: ModelsSequelize): void
  // Model.init signature, only declared so the class stays assignable to Model (Database calls init(sequelize))
  static init<MS extends ModelStatic<Sequelize.Model>, M extends InstanceType<MS>>(this: MS, attributes: ModelAttributes<M, Attributes<M>> | ModelsSequelize, options?: InitOptions<M>): MS
  static init(sequelize: ModelsSequelize) {
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
