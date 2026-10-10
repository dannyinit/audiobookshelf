import Path = require('path')
import uuid = require('uuid')
import fs = require('../libs/fsExtra')
import dateAndTime = require('../libs/dateAndTime')

import Logger = require('../Logger')
import utils = require('../utils/index')
import type Library = require('../models/Library')
import type { DateAndTime } from '../objects/types'
const uuidv4 = uuid.v4
const { secondsToTimestamp, elapsedPretty } = utils

// cast(a): typed view of the minified vendored date-and-time (see DateAndTime)
const date = dateAndTime as unknown as DateAndTime

/**
 * Log line of a library scan
 */
interface LibraryScanLogObject {
  timestamp: string
  message: string
  levelName: string
  level: number
}

class LibraryScan {
  declare id: string | null
  declare type: string | null
  declare library: Library | null
  declare verbose: boolean
  declare startedAt: number | null
  declare finishedAt: number | null
  declare elapsed: number | null
  declare resultsMissing: number
  declare resultsAdded: number
  declare resultsUpdated: number
  declare authorsRemovedFromBooks: string[]
  declare authorsNumBooksChangedIds: Set<string>
  declare seriesRemovedFromBooks: string[]
  declare logs: LibraryScanLogObject[]

  constructor() {
    this.id = null
    this.type = null
    this.library = null
    this.verbose = false

    this.startedAt = null
    this.finishedAt = null
    this.elapsed = null

    this.resultsMissing = 0
    this.resultsAdded = 0
    this.resultsUpdated = 0

    this.authorsRemovedFromBooks = []
    this.authorsNumBooksChangedIds = new Set()
    this.seriesRemovedFromBooks = []

    this.logs = []
  }

  // The library getters and toJSON are used after setData, which sets the library
  get libraryId() {
    // cast(d): the library getters are used after setData, which sets the library
    return this.library!.id
  }
  get libraryName() {
    // cast(d): the library getters are used after setData, which sets the library
    return this.library!.name
  }
  get libraryMediaType() {
    // cast(d): the library getters are used after setData, which sets the library
    return this.library!.mediaType
  }
  get libraryFolders() {
    // cast(d): the library getters are used after setData, which sets the library
    return this.library!.libraryFolders
  }

  get timestamp() {
    return new Date().toISOString()
  }

  get resultStats() {
    return `${this.resultsAdded} Added | ${this.resultsUpdated} Updated | ${this.resultsMissing} Missing`
  }
  get elapsedTimestamp() {
    // cast(d): set by setComplete, which runs before the results are read
    return secondsToTimestamp(this.elapsed! / 1000)
  }
  get logFilename() {
    return date.format(new Date(), 'YYYY-MM-DD') + '_' + this.id + '.txt'
  }
  get scanResultsString() {
    const strs: string[] = []
    if (this.resultsAdded) strs.push(`${this.resultsAdded} added`)
    if (this.resultsUpdated) strs.push(`${this.resultsUpdated} updated`)
    if (this.resultsMissing) strs.push(`${this.resultsMissing} missing`)
    const changesDetected = strs.length > 0 ? strs.join(', ') : 'No changes needed'
    // cast(d): set by setComplete, which runs before the results are read
    const timeElapsed = `(${elapsedPretty(this.elapsed! / 1000)})`
    return `${changesDetected} ${timeElapsed}`
  }

  get scanResults() {
    return {
      added: this.resultsAdded,
      updated: this.resultsUpdated,
      missing: this.resultsMissing,
      elapsed: this.elapsed,
      text: this.scanResultsString
    }
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      // cast(d): toJSON is used after setData, which sets the library
      library: this.library!.toJSON(),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      elapsed: this.elapsed,
      resultsAdded: this.resultsAdded,
      resultsUpdated: this.resultsUpdated,
      resultsMissing: this.resultsMissing
    }
  }

  setData(library: Library, type = 'scan') {
    this.id = uuidv4()
    this.type = type
    this.library = library

    this.startedAt = Date.now()
  }

  setComplete() {
    this.finishedAt = Date.now()
    // cast(d): startedAt is set by setData, which runs before setComplete
    this.elapsed = this.finishedAt - this.startedAt!
  }

  addLog(level: number, ...args: unknown[]) {
    const logObj = {
      timestamp: this.timestamp,
      message: args.join(' '),
      levelName: Logger.getLogLevelString(level),
      level
    }

    if (this.verbose) {
      Logger.debug(`[LibraryScan] "${this.libraryName}":`, ...args)
    }
    this.logs.push(logObj)
  }

  async saveLog() {
    const scanLogDir = Path.join(global.MetadataPath, 'logs', 'scans')

    if (!(await fs.pathExists(scanLogDir))) {
      await fs.mkdir(scanLogDir)
    }

    const outputPath = Path.join(scanLogDir, this.logFilename)
    const logLines = [JSON.stringify(this.toJSON())]
    this.logs.forEach((l) => {
      logLines.push(JSON.stringify(l))
    })
    await fs.writeFile(outputPath, logLines.join('\n') + '\n')

    Logger.info(`[LibraryScan] Scan log saved "${outputPath}"`)
  }
}
export = LibraryScan
