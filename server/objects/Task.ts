import uuid = require('uuid')
import type { TaskString } from './types'
const uuidv4 = uuid.v4

class Task {
  declare id: string | null
  declare action: string | null
  /** custom data */
  declare data: Record<string, unknown> | null

  declare title: string | null
  /** Used for translation */
  declare titleKey: string | null
  /** Used for translation */
  declare titleSubs: string[] | null

  declare description: string | null
  /** Used for translation */
  declare descriptionKey: string | null
  /** Used for translation */
  declare descriptionSubs: string[] | null

  declare error: string | null
  /** Used for translation */
  declare errorKey: string | null
  /** Used for translation */
  declare errorSubs: string[] | null

  /** client should keep the task visible after success */
  declare showSuccess: boolean

  declare isFailed: boolean
  declare isFinished: boolean

  declare startedAt: number | null
  declare finishedAt: number | null
  /** Set by setFailed (not in toJSON) */
  declare failedAt: number

  constructor() {
    this.id = null
    this.action = null // e.g. embed-metadata, encode-m4b, etc
    this.data = null // additional info for the action like libraryItemId

    this.title = null
    this.titleKey = null
    this.titleSubs = null

    this.description = null
    this.descriptionKey = null
    this.descriptionSubs = null

    this.error = null
    this.errorKey = null
    this.errorSubs = null

    this.showSuccess = false

    this.isFailed = false
    this.isFinished = false

    this.startedAt = null
    this.finishedAt = null
  }

  toJSON() {
    return {
      id: this.id,
      action: this.action,
      data: this.data ? { ...this.data } : {},
      title: this.title,
      titleKey: this.titleKey,
      titleSubs: this.titleSubs,
      description: this.description,
      descriptionKey: this.descriptionKey,
      descriptionSubs: this.descriptionSubs,
      error: this.error,
      errorKey: this.errorKey,
      errorSubs: this.errorSubs,
      showSuccess: this.showSuccess,
      isFailed: this.isFailed,
      isFinished: this.isFinished,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt
    }
  }

  /**
   * Set initial task data
   *
   * @param action
   * @param titleString
   * @param descriptionString
   * @param showSuccess
   * @param [data]
   */
  setData(action: string, titleString: TaskString, descriptionString: TaskString | null, showSuccess: boolean, data: Record<string, unknown> = {}) {
    this.id = uuidv4()
    this.action = action
    this.data = { ...data }
    this.title = titleString.text
    this.titleKey = titleString.key || null
    this.titleSubs = titleString.subs || null
    this.description = descriptionString?.text || null
    this.descriptionKey = descriptionString?.key || null
    this.descriptionSubs = descriptionString?.subs || null
    this.showSuccess = showSuccess
    this.startedAt = Date.now()
  }

  /**
   * Set task as failed
   *
   * @param messageString
   */
  setFailed(messageString: TaskString) {
    this.error = messageString.text
    this.errorKey = messageString.key || null
    this.errorSubs = messageString.subs || null
    this.isFailed = true
    this.failedAt = Date.now()
    this.setFinished()
  }

  /**
   * Set task as finished
   *
   * @param [newDescriptionString] update description
   * @param [clearDescription] clear description
   */
  setFinished(newDescriptionString: TaskString | null = null, clearDescription = false) {
    if (newDescriptionString) {
      this.description = newDescriptionString.text
      this.descriptionKey = newDescriptionString.key || null
      this.descriptionSubs = newDescriptionString.subs || null
    } else if (clearDescription) {
      this.description = null
      this.descriptionKey = null
      this.descriptionSubs = null
    }
    this.isFinished = true
    this.finishedAt = Date.now()
  }
}
export = Task
