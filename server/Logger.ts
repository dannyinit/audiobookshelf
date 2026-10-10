import dateAndTime = require('./libs/dateAndTime')
import constants = require('./utils/constants')
import util = require('util')
import type { Socket } from 'socket.io'
import type LogManager = require('./managers/LogManager')
import type { DateAndTime } from './objects/types'
const { LogLevel } = constants

// cast(a): typed view of the minified vendored date-and-time (see DateAndTime)
const date = dateAndTime as unknown as DateAndTime

type LogLevelName = keyof typeof LogLevel

interface SocketListener {
  id: string
  socket: Socket
  level: number
}

class Logger {
  declare logManager: LogManager | null
  declare isDev: boolean
  declare logLevel: number
  declare socketListeners: SocketListener[]

  constructor() {
    this.logManager = null

    this.isDev = process.env.NODE_ENV !== 'production'

    this.logLevel = !this.isDev ? LogLevel.INFO : LogLevel.TRACE
    this.socketListeners = []
  }

  get timestamp(): string {
    return date.format(new Date(), 'YYYY-MM-DD HH:mm:ss.SSS')
  }

  get levelString() {
    return this.getLogLevelString(this.logLevel)
  }

  get source(): string {
    const regex = global.isWin ? /^.*\\([^\\:]*:[0-9]*):[0-9]*\)*/ : /^.*\/([^/:]*:[0-9]*):[0-9]*\)*/
    // cast(d): Error() always has a stack in V8
    return Error().stack!.split('\n')[3].replace(regex, '$1')
  }

  getLogLevelString(level: number) {
    // Same object, typed as a dictionary so it can be read with the loop key
    const logLevels: Record<string, number> = LogLevel
    for (const key in logLevels) {
      if (logLevels[key] === level) {
        return key
      }
    }
    return 'UNKNOWN'
  }

  addSocketListener(socket: Socket, level: number) {
    var index = this.socketListeners.findIndex((s) => s.id === socket.id)
    if (index >= 0) {
      this.socketListeners.splice(index, 1, {
        id: socket.id,
        socket,
        level
      })
    } else {
      this.socketListeners.push({
        id: socket.id,
        socket,
        level
      })
    }
  }

  removeSocketListener(socketId: string) {
    this.socketListeners = this.socketListeners.filter((s) => s.id !== socketId)
  }

  /**
   *
   * @param level
   * @param levelName
   * @param args the values passed to the log method (not only strings; non-strings are inspected)
   * @param src
   */
  async #logToFileAndListeners(level: number, levelName: string, args: unknown[], src: string) {
    const expandedArgs = args.map((arg) => (typeof arg !== 'string' ? util.inspect(arg) : arg))
    const logObj = {
      timestamp: this.timestamp,
      source: src,
      message: expandedArgs.join(' '),
      levelName,
      level
    }

    // Emit log to sockets that are listening to log events
    this.socketListeners.forEach((socketListener) => {
      if (level >= LogLevel.FATAL || level >= socketListener.level) {
        socketListener.socket.emit('log', logObj)
      }
    })

    // Save log to file
    if (level >= LogLevel.FATAL || level >= this.logLevel) {
      await this.logManager?.logToFile(logObj)
    }
  }

  setLogLevel(level: number) {
    this.logLevel = level
    this.debug(`Set Log Level to ${this.levelString}`)
  }

  static ConsoleMethods: Record<LogLevelName, 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'log'> = {
    TRACE: 'trace',
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    FATAL: 'error',
    NOTE: 'log'
  }

  #log(levelName: LogLevelName, source: string, ...args: unknown[]) {
    const level = LogLevel[levelName]
    if (level < LogLevel.FATAL && level < this.logLevel) return
    const consoleMethod = Logger.ConsoleMethods[levelName]
    console[consoleMethod](`[${this.timestamp}] ${levelName}:`, ...args)
    return this.#logToFileAndListeners(level, levelName, args, source)
  }

  trace(...args: unknown[]) {
    this.#log('TRACE', this.source, ...args)
  }

  debug(...args: unknown[]) {
    this.#log('DEBUG', this.source, ...args)
  }

  info(...args: unknown[]) {
    this.#log('INFO', this.source, ...args)
  }

  warn(...args: unknown[]) {
    this.#log('WARN', this.source, ...args)
  }

  error(...args: unknown[]) {
    this.#log('ERROR', this.source, ...args)
  }

  fatal(...args: unknown[]) {
    return this.#log('FATAL', this.source, ...args)
  }

  note(...args: unknown[]) {
    this.#log('NOTE', this.source, ...args)
  }
}
export = new Logger()
