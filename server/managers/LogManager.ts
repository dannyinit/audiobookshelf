import Path = require('path')
import fs = require('../libs/fsExtra')

import Logger = require('../Logger')
import DailyLog = require('../objects/DailyLog')

import constants = require('../utils/constants')
const { LogLevel } = constants

const TAG = '[LogManager]'

class LogManager {
  declare DailyLogPath: string
  declare ScanLogPath: string
  declare currentDailyLog: DailyLog | null
  declare dailyLogBuffer: LogManager.LogObject[]
  declare dailyLogFiles: string[]

  constructor() {
    this.DailyLogPath = Path.posix.join(global.MetadataPath, 'logs', 'daily')
    this.ScanLogPath = Path.posix.join(global.MetadataPath, 'logs', 'scans')

    this.currentDailyLog = null

    this.dailyLogBuffer = []

    this.dailyLogFiles = []
  }

  get loggerDailyLogsToKeep() {
    return global.ServerSettings.loggerDailyLogsToKeep || 7
  }

  async ensureLogDirs() {
    try {
      await fs.ensureDir(this.DailyLogPath)
      await fs.ensureDir(this.ScanLogPath)
    } catch (error) {
      // cast(d): catch variable is unknown
      console.error(`[LogManager] Failed to create log directories at "${this.DailyLogPath}": ${(error as Error).message}`)
      throw new Error(`[LogManager] Failed to create log directories at "${this.DailyLogPath}"`, { cause: error })
    }
  }

  /**
   * 1. Ensure log directories exist
   * 2. Load daily log files
   * 3. Remove old daily log files
   * 4. Create/set current daily log file
   */
  async init() {
    await this.ensureLogDirs()

    // Load daily logs
    await this.scanLogFiles()

    // Check remove extra daily logs
    if (this.dailyLogFiles.length > this.loggerDailyLogsToKeep) {
      const dailyLogFilesCopy = [...this.dailyLogFiles]
      for (let i = 0; i < dailyLogFilesCopy.length - this.loggerDailyLogsToKeep; i++) {
        await this.removeLogFile(dailyLogFilesCopy[i])
      }
    }

    // set current daily log file or create if does not exist
    const currentDailyLogFilename = DailyLog.getCurrentDailyLogFilename()
    Logger.info(TAG, `Init current daily log filename: ${currentDailyLogFilename}`)

    this.currentDailyLog = new DailyLog(this.DailyLogPath)

    if (this.dailyLogFiles.includes(currentDailyLogFilename)) {
      Logger.debug(TAG, `Daily log file already exists - set in Logger`)
      await this.currentDailyLog.loadLogs()
    } else {
      this.dailyLogFiles.push(this.currentDailyLog.filename)
    }

    // Log buffered daily logs
    if (this.dailyLogBuffer.length) {
      this.dailyLogBuffer.forEach((logObj) => {
        // cast(d): set just above
        this.currentDailyLog!.appendLog(logObj)
      })
      this.dailyLogBuffer = []
    }
  }

  /**
   * Load all daily log filenames in /metadata/logs/daily
   */
  async scanLogFiles() {
    const dailyFiles = await fs.readdir(this.DailyLogPath)
    if (dailyFiles?.length) {
      dailyFiles.forEach((logFile) => {
        if (Path.extname(logFile) === '.txt') {
          Logger.debug('Daily Log file found', logFile)
          this.dailyLogFiles.push(logFile)
        } else {
          Logger.debug(TAG, 'Unknown File in Daily log files dir', logFile)
        }
      })
    }
    this.dailyLogFiles.sort()
  }

  async removeLogFile(filename: string) {
    const fullPath = Path.join(this.DailyLogPath, filename)
    const exists = await fs.pathExists(fullPath)
    if (!exists) {
      Logger.error(TAG, 'Invalid log dne ' + fullPath)
      this.dailyLogFiles = this.dailyLogFiles.filter((dlf) => dlf !== filename)
    } else {
      try {
        await fs.unlink(fullPath)
        Logger.info(TAG, 'Removed daily log: ' + filename)
        this.dailyLogFiles = this.dailyLogFiles.filter((dlf) => dlf !== filename)
      } catch (error) {
        Logger.error(TAG, 'Failed to unlink log file ' + fullPath)
      }
    }
  }

  async logToFile(logObj: LogManager.LogObject) {
    // Fatal crashes get logged to a separate file
    if (logObj.level === LogLevel.FATAL) {
      await this.logCrashToFile(logObj)
    }

    // Buffer when logging before daily logs have been initialized
    if (!this.currentDailyLog) {
      this.dailyLogBuffer.push(logObj)
      return
    }

    // Check log rolls to next day
    if (this.currentDailyLog.id !== DailyLog.getCurrentDateString()) {
      this.currentDailyLog = new DailyLog(this.DailyLogPath)
      if (this.dailyLogFiles.length > this.loggerDailyLogsToKeep) {
        // Remove oldest log
        this.removeLogFile(this.dailyLogFiles[0])
      }
    }

    // Append log line to log file
    return this.currentDailyLog.appendLog(logObj)
  }

  async logCrashToFile(logObj: LogManager.LogObject) {
    const line = JSON.stringify(logObj) + '\n'

    const logsDir = Path.join(global.MetadataPath, 'logs')
    await fs.ensureDir(logsDir)
    const crashLogPath = Path.join(logsDir, 'crash_logs.txt')
    return fs.writeFile(crashLogPath, line, { flag: 'a+' }).catch((error: Error) => {
      console.log('[LogManager] Appended crash log', error)
    })
  }

  /**
   * Most recent 5000 daily logs
   */
  getMostRecentCurrentDailyLogs() {
    return this.currentDailyLog?.logs.slice(-5000) || ''
  }
}
namespace LogManager {
  export interface LogObject {
    timestamp: string
    source: string
    message: string
    levelName: string
    level: number
  }
}

export = LogManager
