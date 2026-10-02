import date = require('./libs/dateAndTime')
import { LogLevel } from './utils/constants'
import util = require('util')

type LogLevelName = keyof typeof LogLevel

interface SocketListener {
  id: string
  socket: import('socket.io').Socket
  level: number
}

interface LogObject {
  timestamp: string
  source: string
  message: string
  levelName: string
  level: number
}

class Logger {
  logManager: import('./managers/LogManager') | null
  socketListeners: SocketListener[]
  logLevel: number
  isDev: boolean

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
    return Error().stack!.split('\n')[3].replace(regex, '$1')
  }

  getLogLevelString(level: number): string {
    for (const key in LogLevel) {
      if (LogLevel[key as LogLevelName] === level) {
        return key
      }
    }
    return 'UNKNOWN'
  }

  addSocketListener(socket: SocketListener['socket'], level: number) {
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
   * @param args
   * @param src
   */
  async #logToFileAndListeners(level: number, levelName: string, args: unknown[], src: string) {
    const expandedArgs = args.map((arg) => (typeof arg !== 'string' ? util.inspect(arg) : arg))
    const logObj: LogObject = {
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

  static ConsoleMethods = {
    TRACE: 'trace',
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    FATAL: 'error',
    NOTE: 'log'
  } as const

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
