import uuid = require("uuid")
const uuidv4 = uuid.v4

/**
 * Notification as stored in JSON (see toJSON); the input of the constructor
 */
interface NotificationData {
  id: string
  libraryId?: string | null
  eventName: string
  urls?: string[]
  titleTemplate?: string
  bodyTemplate?: string
  type?: string | null
  enabled?: boolean
  lastFiredAt?: number | null
  lastAttemptFailed?: boolean
  numConsecutiveFailedAttempts?: number
  numTimesFired?: number
  createdAt: number
}

/**
 * Payload to create or update a notification (from the API)
 */
interface NotificationPayload {
  libraryId?: string | null
  eventName?: string
  urls?: string[]
  titleTemplate?: string
  bodyTemplate?: string
  enabled?: boolean
  type?: string | null
}

/**
 * Payload to create a notification (see NotificationSettings.createNotification)
 */
interface NotificationCreatePayload extends NotificationPayload {
  eventName: string
  urls: string[]
  titleTemplate: string
  bodyTemplate: string
}

class Notification {
  declare id: string | null
  declare libraryId: string | null
  declare eventName: string
  declare urls: string[]
  declare titleTemplate: string
  declare bodyTemplate: string
  declare type: string | null
  declare enabled: boolean

  declare lastFiredAt: number | null
  declare lastAttemptFailed: boolean
  declare numConsecutiveFailedAttempts: number
  declare numTimesFired: number
  declare createdAt: number | null

  constructor(notification: NotificationData | null = null) {
    this.id = null
    this.libraryId = null
    this.eventName = ''
    this.urls = []
    this.titleTemplate = ''
    this.bodyTemplate = ''
    this.type = 'info'
    this.enabled = false

    this.lastFiredAt = null
    this.lastAttemptFailed = false
    this.numConsecutiveFailedAttempts = 0
    this.numTimesFired = 0
    this.createdAt = null

    if (notification) {
      this.construct(notification)
    }
  }

  construct(notification: NotificationData) {
    this.id = notification.id
    this.libraryId = notification.libraryId || null
    this.eventName = notification.eventName
    this.urls = notification.urls || []
    this.titleTemplate = notification.titleTemplate || ''
    this.bodyTemplate = notification.bodyTemplate || ''
    this.type = notification.type || 'info'
    this.enabled = !!notification.enabled
    this.lastFiredAt = notification.lastFiredAt || null
    this.lastAttemptFailed = !!notification.lastAttemptFailed
    this.numConsecutiveFailedAttempts = notification.numConsecutiveFailedAttempts || 0
    this.numTimesFired = notification.numTimesFired || 0
    this.createdAt = notification.createdAt
  }

  toJSON() {
    return {
      id: this.id,
      libraryId: this.libraryId,
      eventName: this.eventName,
      urls: this.urls,
      titleTemplate: this.titleTemplate,
      bodyTemplate: this.bodyTemplate,
      enabled: this.enabled,
      type: this.type,
      lastFiredAt: this.lastFiredAt,
      lastAttemptFailed: this.lastAttemptFailed,
      numConsecutiveFailedAttempts: this.numConsecutiveFailedAttempts,
      numTimesFired: this.numTimesFired,
      createdAt: this.createdAt
    }
  }

  setData(payload: NotificationCreatePayload) {
    this.id = uuidv4()
    this.libraryId = payload.libraryId || null
    this.eventName = payload.eventName
    this.urls = payload.urls
    this.titleTemplate = payload.titleTemplate
    this.bodyTemplate = payload.bodyTemplate
    this.enabled = !!payload.enabled
    this.type = payload.type || null
    this.createdAt = Date.now()
  }

  update(payload: NotificationPayload) {
    if (!this.enabled && payload.enabled) {
      // Reset
      this.lastFiredAt = null
      this.lastAttemptFailed = false
      this.numConsecutiveFailedAttempts = 0
    }

    const keysToUpdate = ['libraryId', 'eventName', 'urls', 'titleTemplate', 'bodyTemplate', 'enabled', 'type'] as const
    // Index this object by key
    const self = this as unknown as Record<string, unknown>
    var hasUpdated = false
    for (const key of keysToUpdate) {
      if (payload[key] !== undefined) {
        if (key === 'urls') {
          if (payload[key].join(',') !== this.urls.join(',')) {
            this.urls = [...payload[key]]
            hasUpdated = true
          }
        } else if (payload[key] !== this[key]) {
          self[key] = payload[key]
          hasUpdated = true
        }
      }
    }
    return hasUpdated
  }

  updateNotificationFired(success: boolean) {
    this.lastFiredAt = Date.now()
    this.lastAttemptFailed = !success
    this.numConsecutiveFailedAttempts = success ? 0 : this.numConsecutiveFailedAttempts + 1
    this.numTimesFired++
  }

  replaceVariablesInTemplate(templateText: string, data: Record<string, unknown>) {
    const ptrn = /{{ ?([a-zA-Z]+) ?}}/mg

    var match
    var updatedTemplate = templateText
    while ((match = ptrn.exec(templateText)) != null) {
      if (data[match[1]]) {
        // Event data values are not all strings; replace coerces the replacement to a string, like the JS
        updatedTemplate = updatedTemplate.replace(match[0], data[match[1]] as string)
      }
    }
    return updatedTemplate
  }

  parseTitleTemplate(data: Record<string, unknown>) {
    return this.replaceVariablesInTemplate(this.titleTemplate, data)
  }

  parseBodyTemplate(data: Record<string, unknown>) {
    return this.replaceVariablesInTemplate(this.bodyTemplate, data)
  }

  getApprisePayload(data: Record<string, unknown>) {
    return {
      urls: this.urls,
      title: this.parseTitleTemplate(data),
      body: this.parseBodyTemplate(data)
    }
  }
}
export = Notification
