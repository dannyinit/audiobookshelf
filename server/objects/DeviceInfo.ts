import uuid = require('uuid')
import htmlSanitizer = require('../utils/htmlSanitizer')
const uuidv4 = uuid.v4
const { stripAllTags } = htmlSanitizer

/**
 * Parsed user agent from ua-parser-js (only the fields used)
 */
interface ParsedUserAgent {
  browser: { name?: string; version?: string }
  os: { name?: string; version?: string }
  device: { type?: string }
}

/**
 * Device info sent by the client
 */
interface ClientDeviceInfo {
  deviceId?: string
  clientVersion?: string
  manufacturer?: string
  model?: string
  sdkVersion?: string | number
  clientName?: string
}

class DeviceInfo {
  /** Fields to sanitize when loading from stored data */
  static stringFields: string[] = ['deviceId', 'clientVersion', 'manufacturer', 'model', 'sdkVersion', 'clientName', 'deviceName']

  declare id: string | null
  declare userId: string | null
  declare deviceId: string | null
  declare ipAddress: string | null

  declare browserName: string | null
  declare browserVersion: string | null
  declare osName: string | null
  declare osVersion: string | null
  declare deviceType: string | null

  declare clientVersion: string | null
  declare manufacturer: string | null
  declare model: string | null
  declare sdkVersion: string | null

  declare clientName: string | null
  declare deviceName: string | null

  constructor(deviceInfo: object | null = null) {
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

  construct(deviceInfo: object) {
    // cast(d): this object is read and written by key in the loop below (same object; the class has no index signature)
    const self = this as unknown as Record<string, unknown>
    // cast(d): the stored data is read by key in the loop below (same object)
    const values = deviceInfo as Record<string, unknown>
    for (const key in values) {
      if (values[key] !== undefined && self[key] !== undefined) {
        self[key] = DeviceInfo.stringFields.includes(key) ? stripAllTags(values[key]) : values[key]
      }
    }
  }

  toJSON() {
    const obj: Partial<Record<'id' | 'userId' | 'deviceId' | 'ipAddress' | 'browserName' | 'browserVersion' | 'osName' | 'osVersion' | 'deviceType' | 'clientVersion' | 'manufacturer' | 'model' | 'sdkVersion' | 'clientName' | 'deviceName', string | null>> = {
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
    // cast(d): the JSON object is read and its empty keys deleted by key in the loop below (same object)
    const values = obj as Record<string, string | null | undefined>
    for (const key in obj) {
      if (values[key] === null || values[key] === undefined) {
        delete values[key]
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

  setData(ip: string | null | undefined, ua: ParsedUserAgent | null | undefined, clientDeviceInfo: ClientDeviceInfo | null | undefined, serverVersion: string, userId: string) {
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

  update(deviceInfo: { toJSON?(): object }) {
    const deviceInfoJson = deviceInfo.toJSON ? deviceInfo.toJSON() : deviceInfo
    const existingDeviceInfoJson = this.toJSON()

    // cast(d): this object is read and written by key in the loop below (same object; the class has no index signature)
    const self = this as unknown as Record<string, unknown>
    // cast(d): the new JSON is read by key in the loop below (same object)
    const newValues = deviceInfoJson as Record<string, unknown>
    // cast(d): the existing JSON is read by key in the loop below (same object)
    const existingValues = existingDeviceInfoJson as Record<string, unknown>
    let hasUpdates = false
    for (const key in deviceInfoJson) {
      if (['id', 'deviceId'].includes(key)) continue

      if (newValues[key] !== existingValues[key]) {
        self[key] = newValues[key]
        hasUpdates = true
      }
    }

    for (const key in existingDeviceInfoJson) {
      if (['id', 'deviceId'].includes(key)) continue

      if (existingValues[key] && !newValues[key]) {
        self[key] = null
        hasUpdates = true
      }
    }

    return hasUpdates
  }
}
export = DeviceInfo
