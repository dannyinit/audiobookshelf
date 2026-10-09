import uuid = require('uuid')
import Logger = require('../Logger')
const uuidv4 = uuid.v4

/**
 * Log line of a scan
 */
interface ScanLogObject {
  timestamp: string
  message: string
  levelName: string
  level: number
}

class ScanLogger {
  declare id: string | null
  declare type: string | null
  declare name: string | null
  declare verbose: boolean
  declare startedAt: number | null
  declare finishedAt: number | null
  declare elapsed: number | null
  declare authorsRemovedFromBooks: string[]
  declare authorsNumBooksChangedIds: Set<string>
  declare seriesRemovedFromBooks: string[]
  declare logs: ScanLogObject[]

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

  setData(type: string, name: string) {
    this.id = uuidv4()
    this.type = type
    this.name = name
    this.startedAt = Date.now()
  }

  setComplete() {
    this.finishedAt = Date.now()
    // startedAt is set by setData
    this.elapsed = this.finishedAt - this.startedAt!
  }

  addLog(level: number, ...args: unknown[]) {
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
