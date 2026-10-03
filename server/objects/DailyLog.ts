import Path = require('path')
import dateAndTime = require('../libs/dateAndTime')
import fsExtra = require('../libs/fsExtra')
import fileUtils = require('../utils/fileUtils')
import Logger = require('../Logger')
import type { FsExtra } from '../utils/types'
import type { DateAndTime } from './types'
// Typed views of the untyped vendored date-and-time and fs-extra
const date = dateAndTime as unknown as DateAndTime
const fs = fsExtra as unknown as FsExtra

type LogObject = import('../managers/LogManager').LogObject

class DailyLog {
  declare id: string
  declare dailyLogDirPath: string
  declare filename: string
  declare fullPath: string
  declare createdAt: number
  declare logs: LogObject[]
  declare bufferedLogLines: string[]
  declare locked: boolean

  /**
   * 
   * @param dailyLogDirPath Path to daily logs /metadata/logs/daily
   */
  constructor(dailyLogDirPath: string) {
    this.id = date.format(new Date(), 'YYYY-MM-DD')

    this.dailyLogDirPath = dailyLogDirPath
    this.filename = this.id + '.txt'
    this.fullPath = Path.join(this.dailyLogDirPath, this.filename)

    this.createdAt = Date.now()

    this.logs = []
    this.bufferedLogLines = []

    this.locked = false
  }

  static getCurrentDailyLogFilename() {
    return date.format(new Date(), 'YYYY-MM-DD') + '.txt'
  }

  static getCurrentDateString() {
    return date.format(new Date(), 'YYYY-MM-DD')
  }

  toJSON() {
    return {
      id: this.id,
      dailyLogDirPath: this.dailyLogDirPath,
      fullPath: this.fullPath,
      filename: this.filename,
      createdAt: this.createdAt
    }
  }

  /**
   * Append all buffered lines to daily log file
   */
  appendBufferedLogs(): Promise<void> {
    let buffered = [...this.bufferedLogLines]
    this.bufferedLogLines = []

    let oneBigLog = ''
    buffered.forEach((logLine) => {
      oneBigLog += logLine
    })
    return this.appendLogLine(oneBigLog)
  }

  /**
   * 
   * @param logObj 
   */
  appendLog(logObj: LogObject) {
    this.logs.push(logObj)
    return this.appendLogLine(JSON.stringify(logObj) + '\n')
  }

  /**
   * Append log to daily log file
   * 
   * @param line 
   */
  async appendLogLine(line: string) {
    if (this.locked) {
      this.bufferedLogLines.push(line)
      return
    }
    this.locked = true

    await fs.writeFile(this.fullPath, line, { flag: "a+" }).catch((error) => {
      console.log('[DailyLog] Append log failed', error)
    })

    this.locked = false
    if (this.bufferedLogLines.length) {
      await this.appendBufferedLogs()
    }
  }

  /**
   * Load all logs from file
   * Parses lines and re-saves the file if bad lines are removed
   */
  async loadLogs() {
    if (!await fs.pathExists(this.fullPath)) {
      console.error('Daily log does not exist')
      return
    }

    const text = await fileUtils.readTextFile(this.fullPath)

    let hasFailures = false

    let logLines = text.split(/\r?\n/)
    // remove last log if empty
    if (logLines.length && !logLines[logLines.length - 1]) logLines = logLines.slice(0, -1)

    // JSON parse log lines
    this.logs = logLines.map((t): LogObject | null => {
      if (!t) {
        hasFailures = true
        return null
      }
      try {
        return JSON.parse(t)
      } catch (err) {
        console.error('Failed to parse log line', t, err)
        hasFailures = true
        return null
      }
    }).filter((l): l is LogObject => !!l)

    // Rewrite log file to remove errors
    if (hasFailures) {
      const newLogLines = this.logs.map(l => JSON.stringify(l)).join('\n') + '\n'
      await fs.writeFile(this.fullPath, newLogLines)
      console.log('Re-Saved log file to remove bad lines')
    }

    Logger.debug(`[DailyLog] ${this.id}: Loaded ${this.logs.length} Logs`)
  }
}
export = DailyLog
