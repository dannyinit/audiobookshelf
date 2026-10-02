import date = require('../libs/dateAndTime')
import { v4 as uuidv4 } from 'uuid'
import { version as serverVersion } from '../../package.json'
import DeviceInfo = require('./DeviceInfo')

type ChapterObject = import('../models/Book').ChapterObject
type AudioTrack = import('../models/Book').AudioTrack

class PlaybackSession {
  id: string | null
  userId: string | null
  libraryId: string | null
  libraryItemId: string | null
  bookId: string | null
  episodeId: string | null

  mediaType: string | null
  mediaMetadata: Record<string, any> | null
  chapters: ChapterObject[] | null
  displayTitle: string | null
  displayAuthor: string | null
  coverPath: string | null
  duration: number | null

  playMethod: number | null
  mediaPlayer: string | null
  deviceInfo: DeviceInfo | null
  serverVersion: string | null

  /** YYYY-MM-DD */
  date: string | null
  dayOfWeek: string | null

  timeListening: number | null
  /** media current time at start of playback */
  startTime: number | null
  /** Last current time set */
  currentTime: number

  startedAt: number | null
  updatedAt: number | null

  // Not saved in DB
  lastSave: number
  audioTracks: (AudioTrack | import('./files/AudioTrack'))[]
  stream: import('./Stream') | null
  // Used for share sessions
  shareSessionId: string | null
  mediaItemShareId: string | null
  coverAspectRatio: number | null

  constructor(session?: Record<string, any>) {
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
   * @param {import('../models/LibraryItem')} [libraryItem]
   * @returns
   */
  toJSONForClient(libraryItem?: import('../models/LibraryItem') | null) {
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
      audioTracks: this.audioTracks.map((at) => (at as { toJSON?: () => object }).toJSON?.() || { ...at }),
      libraryItem: libraryItem?.toOldJSONExpanded() || null,
      coverAspectRatio: this.coverAspectRatio !== null ? this.coverAspectRatio : undefined // Used for share sessions
    }
  }

  construct(session: Record<string, any>) {
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
    this.updatedAt = session.updatedAt || session.startedAt

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
   * @param {import('../models/LibraryItem')} libraryItem
   * @param {*} userId
   * @param {*} mediaPlayer
   * @param {*} deviceInfo
   * @param {*} startTime
   * @param {*} episodeId
   */
  setData(libraryItem: import('../models/LibraryItem'), userId: string, mediaPlayer: string, deviceInfo: DeviceInfo | null, startTime: number, episodeId: string | null = null) {
    this.id = uuidv4()
    this.userId = userId
    this.libraryId = libraryItem.libraryId
    this.libraryItemId = libraryItem.id
    this.bookId = episodeId ? null : libraryItem.media.id
    this.episodeId = episodeId
    this.mediaType = libraryItem.mediaType
    this.mediaMetadata = libraryItem.media.oldMetadataToJSON()
    this.chapters = libraryItem.media.getChapters(episodeId)
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
    if (!timeListened || isNaN(timeListened as number)) return

    if (!this.date) {
      // Set date info on first listening update
      this.date = date.format(new Date(), 'YYYY-MM-DD')
      this.dayOfWeek = date.format(new Date(), 'dddd')
    }

    this.timeListening! += Number.parseFloat(timeListened as string)
    this.updatedAt = Date.now()
  }
}
export = PlaybackSession
