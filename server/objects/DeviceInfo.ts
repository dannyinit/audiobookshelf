import { v4 as uuidv4 } from 'uuid'
import { stripAllTags } from '../utils/htmlSanitizer'

/** Subset of a ua-parser-js result used to describe the device */
interface UserAgentInfo {
  browser: { name?: string; version?: string }
  os: { name?: string; version?: string }
  device: { type?: string }
}

class DeviceInfo {
  /** @type {string[]} Fields to sanitize when loading from stored data */
  static stringFields = ['deviceId', 'clientVersion', 'manufacturer', 'model', 'sdkVersion', 'clientName', 'deviceName']
  id: string | null
  userId: string | null
  deviceId: string | null
  ipAddress: string | null

  // From User Agent (see: https://www.npmjs.com/package/ua-parser-js)
  browserName: string | null
  browserVersion: string | null
  osName: string | null
  osVersion: string | null
  deviceType: string | null

  // From client
  clientVersion: string | null
  manufacturer: string | null
  model: string | null
  /** Android Only */
  sdkVersion: string | null

  clientName: string | null
  deviceName: string | null

  constructor(deviceInfo: Record<string, any> | null = null) {
    this.id = null
    this.userId = null
    this.deviceId = null
    this.ipAddress = null

    // From User Agent (see: https://www.npmjs.com/package/ua-parser-js)
    this.browserName = null
    this.browserVersion = null
    this.osName = null
    this.osVersion = null
    this.deviceType = null

    // From client
    this.clientVersion = null
    this.manufacturer = null
    this.model = null
    this.sdkVersion = null // Android Only

    this.clientName = null
    this.deviceName = null

    if (deviceInfo) {
      this.construct(deviceInfo)
    }
  }

  construct(deviceInfo: Record<string, any>) {
    const self = this as Record<string, any>
    for (const key in deviceInfo) {
      if (deviceInfo[key] !== undefined && self[key] !== undefined) {
        self[key] = DeviceInfo.stringFields.includes(key) ? stripAllTags(deviceInfo[key]) : deviceInfo[key]
      }
    }
  }

  toJSON() {
    const obj: Partial<Record<keyof DeviceInfo, string | null>> = {
      id: this.id,
      userId: this.userId,
      deviceId: this.deviceId,
      ipAddress: this.ipAddress,
      browserName: this.browserName,
      browserVersion: this.browserVersion,
      osName: this.osName,
      osVersion: this.osVersion,
      deviceType: this.deviceType,
      clientVersion: this.clientVersion,
      manufacturer: this.manufacturer,
      model: this.model,
      sdkVersion: this.sdkVersion,
      clientName: this.clientName,
      deviceName: this.deviceName
    }
    for (const key in obj) {
      if (obj[key as keyof typeof obj] === null || obj[key as keyof typeof obj] === undefined) {
        delete obj[key as keyof typeof obj]
      }
    }
    return obj
  }

  get deviceDescription() {
    if (this.model) {
      // Set from mobile apps
      if (this.sdkVersion) return `${this.model} SDK ${this.sdkVersion} / v${this.clientVersion}`
      return `${this.model} / v${this.clientVersion}`
    }
    return `${this.osName} ${this.osVersion} / ${this.browserName}`
  }

  // When client doesn't send a device id
  getTempDeviceId() {
    const keys = [this.userId, this.browserName, this.browserVersion, this.osName, this.osVersion, this.clientVersion, this.manufacturer, this.model, this.sdkVersion, this.ipAddress].map((k) => k || '')
    return 'temp-' + Buffer.from(keys.join('-'), 'utf-8').toString('base64')
  }

  setData(ip: string | null | undefined, ua: UserAgentInfo | null | undefined, clientDeviceInfo: Record<string, any> | null | undefined, serverVersion: string, userId: string) {
    this.id = uuidv4()
    this.userId = userId
    this.deviceId = clientDeviceInfo?.deviceId || this.id
    this.ipAddress = ip || null

    this.browserName = ua?.browser.name || null
    this.browserVersion = ua?.browser.version || null
    this.osName = ua?.os.name || null
    this.osVersion = ua?.os.version || null
    this.deviceType = ua?.device.type || null

    this.clientVersion = stripAllTags(clientDeviceInfo?.clientVersion) || serverVersion
    this.manufacturer = stripAllTags(clientDeviceInfo?.manufacturer) || null
    this.model = stripAllTags(clientDeviceInfo?.model) || null

    if (typeof clientDeviceInfo?.sdkVersion === 'number') {
      this.sdkVersion = clientDeviceInfo.sdkVersion.toString()
    } else {
      this.sdkVersion = stripAllTags(clientDeviceInfo?.sdkVersion) || null
    }

    this.clientName = stripAllTags(clientDeviceInfo?.clientName) || null
    if (this.sdkVersion) {
      if (!this.clientName) this.clientName = 'Abs Android'
      this.deviceName = `${this.manufacturer || 'Unknown'} ${this.model || ''}`
    } else if (this.model) {
      if (!this.clientName) this.clientName = 'Abs iOS'
      this.deviceName = `${this.manufacturer || 'Unknown'} ${this.model || ''}`
    } else if (this.osName && this.browserName) {
      if (!this.clientName) this.clientName = 'Abs Web'
      this.deviceName = `${this.osName} ${this.osVersion || 'N/A'} ${this.browserName}`
    } else if (!this.clientName) {
      this.clientName = 'Unknown'
    }

    if (!this.deviceId) {
      this.deviceId = this.getTempDeviceId()
    }
  }

  update(deviceInfo: DeviceInfo | Record<string, any>) {
    const deviceInfoJson: Record<string, any> = deviceInfo.toJSON ? deviceInfo.toJSON() : deviceInfo
    const existingDeviceInfoJson: Record<string, any> = this.toJSON()
    const self = this as Record<string, any>

    let hasUpdates = false
    for (const key in deviceInfoJson) {
      if (['id', 'deviceId'].includes(key)) continue

      if (deviceInfoJson[key] !== existingDeviceInfoJson[key]) {
        self[key] = deviceInfoJson[key]
        hasUpdates = true
      }
    }

    for (const key in existingDeviceInfoJson) {
      if (['id', 'deviceId'].includes(key)) continue

      if (existingDeviceInfoJson[key] && !deviceInfoJson[key]) {
        self[key] = null
        hasUpdates = true
      }
    }

    return hasUpdates
  }
}
export = DeviceInfo
