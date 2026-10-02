import type SMTPTransport = require('nodemailer/lib/smtp-transport')
import Logger = require('../../Logger')
import { areEquivalent, copyValue, isNullOrNaN } from '../../utils'

interface EreaderDeviceObject {
  name: string
  email: string
  availabilityOption: string
  users: string[]
}

// REF: https://nodemailer.com/smtp/
class EmailSettings {
  id: string
  host: string | null
  port: number
  secure: boolean
  rejectUnauthorized: boolean
  user: string | null
  pass: string | null
  testAddress: string | null
  fromAddress: string | null
  ereaderDevices: EreaderDeviceObject[]

  constructor(settings: Record<string, any> | null = null) {
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

  construct(settings: Record<string, any>) {
    this.host = settings.host
    this.port = settings.port
    this.secure = !!settings.secure
    this.rejectUnauthorized = !!settings.rejectUnauthorized
    this.user = settings.user
    this.pass = settings.pass
    this.testAddress = settings.testAddress
    this.fromAddress = settings.fromAddress
    this.ereaderDevices = settings.ereaderDevices?.map((d: EreaderDeviceObject) => ({ ...d })) || []

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

  update(payload: Record<string, any>) {
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
      payload.ereaderDevices = payload.ereaderDevices
        .map((device: EreaderDeviceObject) => {
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
        .filter((d: EreaderDeviceObject | null) => d)
    }

    let hasUpdates = false

    const json: Record<string, any> = this.toJSON()
    for (const key in json) {
      if (key === 'id') continue

      if (payload[key] !== undefined && !areEquivalent(payload[key], json[key])) {
        ;(this as Record<string, any>)[key] = copyValue(payload[key])
        hasUpdates = true
      }
    }

    return hasUpdates
  }

  getTransportObject(): SMTPTransport.Options {
    const payload: SMTPTransport.Options = {
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
   * @param {EreaderDeviceObject} device
   * @param {import('../../models/User')} user
   * @returns {boolean}
   */
  checkUserCanAccessDevice(device: EreaderDeviceObject, user: import('../../models/User')): boolean {
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
   * @param {import('../../models/User')} user
   * @returns {EreaderDeviceObject[]}
   */
  getEReaderDevices(user: import('../../models/User')): EreaderDeviceObject[] {
    return this.ereaderDevices.filter((device) => this.checkUserCanAccessDevice(device, user))
  }

  /**
   * Get ereader device by name
   *
   * @param {string} deviceName
   * @returns {EreaderDeviceObject}
   */
  getEReaderDevice(deviceName: string): EreaderDeviceObject | undefined {
    return this.ereaderDevices.find((d) => d.name === deviceName)
  }
}
export = EmailSettings
