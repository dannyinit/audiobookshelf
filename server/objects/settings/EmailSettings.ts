import Logger = require('../../Logger')
import utils = require('../../utils')
import type User = require('../../models/User')
const { areEquivalent, copyValue, isNullOrNaN } = utils

interface EreaderDeviceObject {
  name: string
  email: string
  availabilityOption: string
  users: string[]
}

/**
 * Stored email settings (see toJSON), the input of the constructor
 */
interface EmailSettingsData {
  host: string | null
  port: number
  secure?: boolean
  rejectUnauthorized?: boolean
  user: string | null
  pass: string | null
  testAddress: string | null
  fromAddress: string | null
  ereaderDevices?: EreaderDeviceObject[]
}

/**
 * Nodemailer SMTP transport options built by getTransportObject
 */
interface TransportObject {
  host: string | null
  secure: boolean
  port?: number
  auth?: { user: string; pass: string | null }
  tls?: { rejectUnauthorized: boolean }
}

// REF: https://nodemailer.com/smtp/
class EmailSettings {
  declare id: string
  declare host: string | null
  declare port: number
  declare secure: boolean
  declare rejectUnauthorized: boolean
  declare user: string | null
  declare pass: string | null
  declare testAddress: string | null
  declare fromAddress: string | null

  declare ereaderDevices: EreaderDeviceObject[]

  constructor(settings: EmailSettingsData | null = null) {
    this.id = 'email-settings'
    this.host = null
    this.port = 465
    this.secure = true
    this.rejectUnauthorized = true
    this.user = null
    this.pass = null
    this.testAddress = null
    this.fromAddress = null

    this.ereaderDevices = []

    if (settings) {
      this.construct(settings)
    }
  }

  construct(settings: EmailSettingsData) {
    this.host = settings.host
    this.port = settings.port
    this.secure = !!settings.secure
    this.rejectUnauthorized = !!settings.rejectUnauthorized
    this.user = settings.user
    this.pass = settings.pass
    this.testAddress = settings.testAddress
    this.fromAddress = settings.fromAddress
    this.ereaderDevices = settings.ereaderDevices?.map((d) => ({ ...d })) || []

    // rejectUnauthorized added after v2.10.1 - defaults to true
    if (settings.rejectUnauthorized === undefined) {
      this.rejectUnauthorized = true
    }
  }

  toJSON() {
    return {
      id: this.id,
      host: this.host,
      port: this.port,
      secure: this.secure,
      rejectUnauthorized: this.rejectUnauthorized,
      user: this.user,
      pass: this.pass,
      testAddress: this.testAddress,
      fromAddress: this.fromAddress,
      ereaderDevices: this.ereaderDevices.map((d) => ({ ...d }))
    }
  }

  update(payload: Record<string, unknown> & { port?: unknown; secure?: unknown; rejectUnauthorized?: unknown; ereaderDevices?: Partial<EreaderDeviceObject>[] } | null | undefined) {
    if (!payload) return false

    if (payload.port !== undefined) {
      if (isNullOrNaN(payload.port)) payload.port = 465
      else payload.port = Number(payload.port)
    }
    if (payload.secure !== undefined) payload.secure = !!payload.secure
    if (payload.rejectUnauthorized !== undefined) payload.rejectUnauthorized = !!payload.rejectUnauthorized

    if (payload.ereaderDevices !== undefined && !Array.isArray(payload.ereaderDevices)) payload.ereaderDevices = undefined

    if (payload.ereaderDevices?.length) {
      // Validate ereader devices
      // cast(d): filter removes the null (invalid) devices, but TypeScript keeps null in the element type
      payload.ereaderDevices = payload.ereaderDevices
        .map((device) => {
          if (!device.name || !device.email) {
            Logger.error(`[EmailSettings] Update ereader device is invalid`, device)
            return null
          }
          if (!device.availabilityOption || !['adminOrUp', 'userOrUp', 'guestOrUp', 'specificUsers'].includes(device.availabilityOption)) {
            device.availabilityOption = 'adminOrUp'
          }
          if (device.availabilityOption === 'specificUsers' && !device.users?.length) {
            device.availabilityOption = 'adminOrUp'
          }
          if (device.availabilityOption !== 'specificUsers' && device.users?.length) {
            device.users = []
          }
          return device
        })
        .filter((d) => d) as Partial<EreaderDeviceObject>[]
    }

    let hasUpdates = false

    const json = this.toJSON()
    // cast(d): this object is written by key in the loop below (same object; the class has no index signature)
    const self = this as unknown as Record<string, unknown>
    // cast(d): the JSON is read by key in the loop below (same object)
    const jsonValues = json as Record<string, unknown>
    for (const key in json) {
      if (key === 'id') continue

      if (payload[key] !== undefined && !areEquivalent(payload[key], jsonValues[key])) {
        self[key] = copyValue(payload[key])
        hasUpdates = true
      }
    }

    return hasUpdates
  }

  getTransportObject() {
    const payload: TransportObject = {
      host: this.host,
      secure: this.secure
    }
    // Only set to true for port 465 (https://nodemailer.com/smtp/#tls-options)
    if (this.port !== 465) {
      payload.secure = false
    }
    if (this.port) payload.port = this.port
    if (this.user && this.pass !== undefined) {
      payload.auth = {
        user: this.user,
        pass: this.pass
      }
    }
    // Allow self-signed certs (https://nodemailer.com/smtp/#3-allow-self-signed-certificates)
    if (!this.rejectUnauthorized) {
      payload.tls = {
        rejectUnauthorized: false
      }
    }

    return payload
  }

  /**
   *
   * @param device
   * @param user
   */
  checkUserCanAccessDevice(device: EreaderDeviceObject, user: User): boolean {
    let deviceAvailability = device.availabilityOption || 'adminOrUp'
    if (deviceAvailability === 'adminOrUp' && user.isAdminOrUp) return true
    if (deviceAvailability === 'userOrUp' && (user.isAdminOrUp || user.isUser)) return true
    if (deviceAvailability === 'guestOrUp') return true
    if (deviceAvailability === 'specificUsers') {
      let deviceUsers = device.users || []
      return deviceUsers.includes(user.id)
    }
    return false
  }

  /**
   * Get ereader devices accessible to user
   *
   * @param user
   */
  getEReaderDevices(user: User): EreaderDeviceObject[] {
    return this.ereaderDevices.filter((device) => this.checkUserCanAccessDevice(device, user))
  }

  /**
   * Get ereader device by name
   *
   * @param deviceName
   */
  getEReaderDevice(deviceName: string) {
    return this.ereaderDevices.find((d) => d.name === deviceName)
  }
}
export = EmailSettings
