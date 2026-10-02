const uuidv4 = require('uuid').v4

/**
 * @typedef TaskString
 * @property {string} text
 * @property {string} key
 * @property {string[]} [subs]
 */

class Task {
  /** @type {string} */
  id: string
  /** @type {string} */
  action: string
  /** @type {Object} custom data */
  data: object
  /** @type {string} */
  title: string
  /** @type {string} - Used for translation */
  titleKey: string
  /** @type {string[]} - Used for translation */
  titleSubs: string[]
  /** @type {string} */
  description: string
  /** @type {string} - Used for translation */
  descriptionKey: string
  /** @type {string[]} - Used for translation */
  descriptionSubs: string[]
  /** @type {string} */
  error: string
  /** @type {string} - Used for translation */
  errorKey: string
  /** @type {string[]} - Used for translation */
  errorSubs: string[]
  /** @type {boolean} client should keep the task visible after success */
  showSuccess: boolean
  /** @type {boolean} */
  isFailed: boolean
  /** @type {boolean} */
  isFinished: boolean
  /** @type {number} */
  startedAt: number
  /** @type {number} */
  finishedAt: number
  task: any
  failedAt: number

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
   * @param {string} action
   * @param {TaskString} titleString
   * @param {TaskString|null} descriptionString
   * @param {boolean} showSuccess
   * @param {Object} [data]
   */
  setData(action: string, titleString: TaskString, descriptionString: TaskString | null, showSuccess: boolean, data: object = {}) {
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
   * @param {TaskString} messageString
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
   * @param {TaskString} [newDescriptionString] update description
   * @param {boolean} [clearDescription] clear description
   */
  setFinished(newDescriptionString: TaskString = null, clearDescription: boolean = false) {
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
