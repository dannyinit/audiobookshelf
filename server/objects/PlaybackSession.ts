import dateAndTime = require('../libs/dateAndTime')
import uuid = require('uuid')
import packageJson = require('../../package.json')
import DeviceInfo = require('./DeviceInfo')
import type LibraryItem = require('../models/LibraryItem')
import type AudioTrack = require('./files/AudioTrack')
import type Stream = require('./Stream')
import type { AudioChapter, DateAndTime } from './types'
// Typed view of the untyped vendored date-and-time
const date = dateAndTime as unknown as DateAndTime
const uuidv4 = uuid.v4
const serverVersion = packageJson.version

/**
 * PlaybackSession as stored in JSON (see toJSON); the input of the constructor
 */
interface PlaybackSessionData {
  id: string
  userId: string
  libraryId?: string | null
  libraryItemId: string | null
  bookId?: string | null
  episodeId: string | null
  mediaType: string
  mediaMetadata: object | null
  chapters?: AudioChapter[] | null
  displayTitle?: string | null
  displayAuthor?: string | null
  coverPath: string | null
  duration: number | null
  playMethod: number | null
  mediaPlayer?: string | null
  deviceInfo?: DeviceInfo | object | null
  serverVersion: string | null
  date: string | null
  dayOfWeek: string | null
  timeListening?: number | null
  startTime?: number | null
  currentTime?: number | null
  startedAt: number | null
  updatedAt?: number | null
}

class PlaybackSession {
  declare id: string | null
  declare userId: string | null
  declare libraryId: string | null
  declare libraryItemId: string | null
  declare bookId: string | null
  declare episodeId: string | null

  declare mediaType: string | null
  declare mediaMetadata: object | null
  declare chapters: AudioChapter[] | null
  declare displayTitle: string | null
  declare displayAuthor: string | null
  declare coverPath: string | null
  declare duration: number | null

  declare playMethod: number | null
  declare mediaPlayer: string | null
  declare deviceInfo: DeviceInfo | null
  declare serverVersion: string | null

  declare date: string | null
  declare dayOfWeek: string | null

  declare timeListening: number | null
  declare startTime: number | null
  declare currentTime: number

  declare startedAt: number | null
  declare updatedAt: number | null

  // Not saved in DB
  declare lastSave: number
  declare audioTracks: AudioTrack[]
  declare stream: Stream | null
  // Used for share sessions
  declare shareSessionId: string | null
  declare mediaItemShareId: string | null
  declare coverAspectRatio: number | null

  constructor(session?: PlaybackSessionData | null) {
    this.id = null
    this.userId = null
    this.libraryId = null
    this.libraryItemId = null
    this.bookId = null
    this.episodeId = null

    this.mediaType = null
    this.mediaMetadata = null
    this.chapters = null
    this.displayTitle = null
    this.displayAuthor = null
    this.coverPath = null
    this.duration = null

    this.playMethod = null
    this.mediaPlayer = null
    this.deviceInfo = null
    this.serverVersion = null

    this.date = null
    this.dayOfWeek = null

    this.timeListening = null
    this.startTime = null // media current time at start of playback
    this.currentTime = 0 // Last current time set

    this.startedAt = null
    this.updatedAt = null

    // Not saved in DB
    this.lastSave = 0
    this.audioTracks = []
    this.stream = null
    // Used for share sessions
    this.shareSessionId = null
    this.mediaItemShareId = null
    this.coverAspectRatio = null

    if (session) {
      this.construct(session)
    }
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      libraryId: this.libraryId,
      libraryItemId: this.libraryItemId,
      bookId: this.bookId,
      episodeId: this.episodeId,
      mediaType: this.mediaType,
      mediaMetadata: structuredClone(this.mediaMetadata),
      chapters: (this.chapters || []).map((c) => ({ ...c })),
      displayTitle: this.displayTitle,
      displayAuthor: this.displayAuthor,
      coverPath: this.coverPath,
      duration: this.duration,
      playMethod: this.playMethod,
      mediaPlayer: this.mediaPlayer,
      deviceInfo: this.deviceInfo?.toJSON() || null,
      serverVersion: this.serverVersion,
      date: this.date,
      dayOfWeek: this.dayOfWeek,
      timeListening: this.timeListening,
      startTime: this.startTime,
      currentTime: this.currentTime,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt
    }
  }

  /**
   * Session data to send to clients
   * @param [libraryItem]
   * @returns
   */
  toJSONForClient(libraryItem?: LibraryItem) {
    return {
      id: this.id,
      userId: this.userId,
      libraryId: this.libraryId,
      libraryItemId: this.libraryItemId,
      bookId: this.bookId,
      episodeId: this.episodeId,
      mediaType: this.mediaType,
      mediaMetadata: structuredClone(this.mediaMetadata),
      chapters: (this.chapters || []).map((c) => ({ ...c })),
      displayTitle: this.displayTitle,
      displayAuthor: this.displayAuthor,
      coverPath: this.coverPath,
      duration: this.duration,
      playMethod: this.playMethod,
      mediaPlayer: this.mediaPlayer,
      deviceInfo: this.deviceInfo?.toJSON() || null,
      serverVersion: this.serverVersion,
      date: this.date,
      dayOfWeek: this.dayOfWeek,
      timeListening: this.timeListening,
      startTime: this.startTime,
      currentTime: this.currentTime,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      audioTracks: this.audioTracks.map((at) => at.toJSON?.() || { ...at }),
      libraryItem: libraryItem?.toOldJSONExpanded() || null,
      coverAspectRatio: this.coverAspectRatio !== null ? this.coverAspectRatio : undefined // Used for share sessions
    }
  }

  construct(session: PlaybackSessionData) {
    this.id = session.id
    this.userId = session.userId
    this.libraryId = session.libraryId || null
    this.libraryItemId = session.libraryItemId
    this.bookId = session.bookId || null
    this.episodeId = session.episodeId
    this.mediaType = session.mediaType
    this.duration = session.duration
    this.playMethod = session.playMethod
    this.mediaPlayer = session.mediaPlayer || null

    // Temp do not store old IDs
    if (this.libraryId?.startsWith('lib_')) {
      this.libraryId = null
    }
    if (this.libraryItemId?.startsWith('li_') || this.libraryItemId?.startsWith('local_')) {
      this.libraryItemId = null
    }
    if (this.episodeId?.startsWith('ep_') || this.episodeId?.startsWith('local_')) {
      this.episodeId = null
    }

    if (session.deviceInfo instanceof DeviceInfo) {
      this.deviceInfo = new DeviceInfo(session.deviceInfo.toJSON())
    } else {
      this.deviceInfo = new DeviceInfo(session.deviceInfo)
    }

    this.serverVersion = session.serverVersion
    this.chapters = session.chapters || []

    this.mediaMetadata = session.mediaMetadata
    this.displayTitle = session.displayTitle || ''
    this.displayAuthor = session.displayAuthor || ''
    this.coverPath = session.coverPath
    this.date = session.date
    this.dayOfWeek = session.dayOfWeek

    this.timeListening = session.timeListening || null
    this.startTime = session.startTime || 0
    this.currentTime = session.currentTime || 0

    this.startedAt = session.startedAt
    // Copied as given (possibly undefined), like the JS
    this.updatedAt = (session.updatedAt || session.startedAt) as number | null

    // Local playback sessions dont set this date field so set using updatedAt
    if (!this.date && session.updatedAt) {
      this.date = date.format(new Date(session.updatedAt), 'YYYY-MM-DD')
      this.dayOfWeek = date.format(new Date(session.updatedAt), 'dddd')
    }
  }

  get mediaItemId() {
    if (this.episodeId) return `${this.libraryItemId}-${this.episodeId}`
    return this.libraryItemId
  }

  get progress() {
    // Value between 0 and 1
    if (!this.duration) return 0
    return Math.max(0, Math.min(this.currentTime / this.duration, 1))
  }

  get deviceId() {
    return this.deviceInfo?.id
  }

  get deviceDescription() {
    if (!this.deviceInfo) return 'No Device Info'
    return this.deviceInfo.deviceDescription
  }

  get mediaProgressObject() {
    return {
      duration: this.duration,
      currentTime: this.currentTime,
      progress: this.progress,
      lastUpdate: this.updatedAt
    }
  }

  /**
   *
   * @param libraryItem
   * @param userId
   * @param mediaPlayer
   * @param deviceInfo
   * @param startTime
   * @param episodeId
   */
  setData(libraryItem: LibraryItem, userId: string, mediaPlayer: string, deviceInfo: DeviceInfo | null, startTime: number, episodeId: string | null = null) {
    this.id = uuidv4()
    this.userId = userId
    this.libraryId = libraryItem.libraryId
    this.libraryItemId = libraryItem.id
    this.bookId = episodeId ? null : libraryItem.media.id
    this.episodeId = episodeId
    this.mediaType = libraryItem.mediaType
    this.mediaMetadata = libraryItem.media.oldMetadataToJSON()
    // Book media ignores the episode id; podcast sessions always pass one
    this.chapters = libraryItem.media.getChapters(episodeId as string)
    this.displayTitle = libraryItem.media.getPlaybackTitle(episodeId)
    this.displayAuthor = libraryItem.media.getPlaybackAuthor()
    this.coverPath = libraryItem.media.coverPath
    this.duration = libraryItem.media.getPlaybackDuration(episodeId)

    this.mediaPlayer = mediaPlayer
    this.deviceInfo = deviceInfo || new DeviceInfo()
    this.serverVersion = serverVersion

    this.timeListening = 0
    this.startTime = startTime
    this.currentTime = startTime

    this.date = date.format(new Date(), 'YYYY-MM-DD')
    this.dayOfWeek = date.format(new Date(), 'dddd')
    this.startedAt = Date.now()
    this.updatedAt = Date.now()
  }

  addListeningTime(timeListened: number | string) {
    // isNaN coerces its argument
    if (!timeListened || isNaN(timeListened as number)) return

    if (!this.date) {
      // Set date info on first listening update
      this.date = date.format(new Date(), 'YYYY-MM-DD')
      this.dayOfWeek = date.format(new Date(), 'dddd')
    }

    // timeListening is null before the first update (null + n is n); parseFloat coerces numbers to strings
    (this.timeListening as number) += Number.parseFloat(timeListened as string)
    this.updatedAt = Date.now()
  }
}
export = PlaybackSession
