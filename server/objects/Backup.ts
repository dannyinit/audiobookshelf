import Path = require('path')
import dateAndTime = require('../libs/dateAndTime')
import packageJson = require('../../package.json')
import type { DateAndTime } from './types'
// cast(a): typed view of the untyped vendored date-and-time (see DateAndTime)
const date = dateAndTime as unknown as DateAndTime
const version = packageJson.version

class Backup {
  declare id: string | null
  declare key: string | null
  declare datePretty: string | null

  declare backupDirPath: string | null
  declare filename: string | null
  declare path: string | null
  declare fullPath: string | null
  declare serverVersion: string | null

  declare fileSize: number | null
  declare createdAt: number | null

  constructor(data: { details: string[]; fullPath: string } | null = null) {
    this.id = null
    this.key = null // Special key for pre-version checks
    this.datePretty = null

    this.backupDirPath = null
    this.filename = null
    this.path = null
    this.fullPath = null
    this.serverVersion = null

    this.fileSize = null
    this.createdAt = null

    if (data) {
      this.construct(data)
    }
  }

  get detailsString() {
    const details = []
    details.push(this.id)
    details.push(this.key)
    details.push(this.createdAt)
    details.push(this.serverVersion)
    return details.join('\n')
  }

  construct(data: { details: string[]; fullPath: string }) {
    this.id = data.details[0]
    this.key = data.details[1]
    // cast(d): key is a string; the loose comparison with the number 1 coerces it, like the JS
    if ((this.key as unknown as number) == 1) this.key = null // v2.2.23 and below backups stored '1' here

    this.createdAt = Number(data.details[2])
    this.serverVersion = data.details[3] || null

    this.datePretty = date.format(new Date(this.createdAt), 'ddd, MMM D YYYY HH:mm')

    this.backupDirPath = Path.dirname(data.fullPath)
    this.filename = Path.basename(data.fullPath)
    this.path = Path.join('backups', this.filename)
    this.fullPath = data.fullPath
  }

  toJSON() {
    return {
      id: this.id,
      key: this.key,
      backupDirPath: this.backupDirPath,
      datePretty: this.datePretty,
      fullPath: this.fullPath,
      path: this.path,
      filename: this.filename,
      fileSize: this.fileSize,
      createdAt: this.createdAt,
      serverVersion: this.serverVersion
    }
  }

  setData(backupDirPath: string) {
    this.id = date.format(new Date(), 'YYYY-MM-DD[T]HHmm')
    this.key = 'sqlite'
    this.datePretty = date.format(new Date(), 'ddd, MMM D YYYY HH:mm')

    this.backupDirPath = backupDirPath

    this.filename = this.id + '.audiobookshelf'
    this.path = Path.join('backups', this.filename)
    this.fullPath = Path.join(this.backupDirPath, this.filename)

    this.serverVersion = version

    this.createdAt = Date.now()
  }
}
export = Backup
