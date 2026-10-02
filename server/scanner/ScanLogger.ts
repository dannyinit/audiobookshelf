const uuidv4 = require('uuid').v4
import Logger = require('../Logger')

class ScanLogger {
  /** @type {string[]} */
  authorsRemovedFromBooks: string[]
  /** @type {Set<string>} */
  authorsNumBooksChangedIds: Set<string>
  /** @type {string[]} */
  seriesRemovedFromBooks: string[]
  verbose: boolean
  logs: { timestamp: string; message: string; levelName: string; level: any }[]
  elapsed: number | null
  finishedAt: number | null
  startedAt: number | null
  name: null
  type: null
  id: null

  constructor() {
    this.id = null
    this.type = null
    this.name = null
    this.verbose = false

    this.startedAt = null
    this.finishedAt = null
    this.elapsed = null

    this.authorsRemovedFromBooks = []
    this.authorsNumBooksChangedIds = new Set()
    this.seriesRemovedFromBooks = []

    this.logs = []
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      elapsed: this.elapsed
    }
  }

  setData(type, name) {
    this.id = uuidv4()
    this.type = type
    this.name = name
    this.startedAt = Date.now()
  }

  setComplete() {
    this.finishedAt = Date.now()
    this.elapsed = this.finishedAt - this.startedAt
  }

  addLog(level, ...args) {
    const logObj = {
      timestamp: new Date().toISOString(),
      message: args.join(' '),
      levelName: Logger.getLogLevelString(level),
      level
    }

    if (this.verbose) {
      Logger.debug(`[Scan] "${this.name}":`, ...args)
    }
    this.logs.push(logObj)
  }
}
export = ScanLogger
