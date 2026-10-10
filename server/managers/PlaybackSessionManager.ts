import uuid = require('uuid')
import Path = require('path')
import packageJson = require('../../package.json')
import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import Database = require('../Database')

import dateAndTime = require('../libs/dateAndTime')
import fs = require('../libs/fsExtra')
import uaParserJs = require('../libs/uaParser')
import requestIp = require('../libs/requestIp')

import constants = require('../utils/constants')

import PlaybackSession = require('../objects/PlaybackSession')
import DeviceInfo = require('../objects/DeviceInfo')
import Stream = require('../objects/Stream')
import type { Request, Response } from 'express'
import type User = require('../models/User')
import type LibraryItem = require('../models/LibraryItem')
import type Podcast = require('../models/Podcast')
import type { DateAndTime } from '../objects/types'
import type { AudioTrack as AudioTrackObject } from '../models/types'
const uuidv4 = uuid.v4
const serverVersion = packageJson.version
const { PlayMethod } = constants

// cast(a): typed view of the minified vendored date-and-time (see DateAndTime)
const date = dateAndTime as unknown as DateAndTime

/**
 * Device info sent by the client
 */
type ClientDeviceInfo = NonNullable<Parameters<DeviceInfo['setData']>[2]>

/**
 * Old device info with its id set, as the Device model stores it
 */
type OldDeviceInfo = Parameters<typeof Database.deviceModel.createFromOld>[0]

/**
 * Request with the user and the client device info in the body (set by the auth and controller middleware)
 */
type PlaybackRequest = Request & { user: User }

/**
 * Request to start a session, with the library item loaded by the library item controller middleware
 */
type StartSessionRequest = PlaybackRequest & { libraryItem: LibraryItem.LibraryItemExpanded }

/**
 * Local playback session sent by a client (stored session JSON with the ids the server maps)
 */
type LocalSessionJson = ConstructorParameters<typeof PlaybackSession>[0] & {
  id: string
  libraryItemId: string
  episodeId: string | null
  bookId?: string | null
  libraryId?: string | null
  updatedAt: number
  currentTime: number
  timeListening: number
}

/**
 * Options of a start session request
 */
interface StartSessionOptions {
  forceDirectPlay?: boolean
  forceTranscode?: boolean
  mediaPlayer: string
  supportedMimeTypes?: string[]
}

/**
 * Progress sent with a sync or close session request
 */
interface SyncData {
  currentTime: number
  timeListened: number | string
  duration?: number
}

class PlaybackSessionManager {
  declare StreamsPath: string
  declare oldPlaybackSessionMap: Record<string, string>
  declare sessions: PlaybackSession[]

  constructor() {
    this.StreamsPath = Path.join(global.MetadataPath, 'streams')

    this.oldPlaybackSessionMap = {} // TODO: Remove after updated mobile versions

    this.sessions = []
  }

  /**
   * Get open session by id
   */
  getSession(sessionId: string) {
    return this.sessions.find((s) => s.id === sessionId)
  }
  getUserSession(userId: string) {
    return this.sessions.find((s) => s.userId === userId)
  }
  getStream(sessionId: string) {
    const session = this.getSession(sessionId)
    return session?.stream || null
  }

  async getDeviceInfo(req: PlaybackRequest, clientDeviceInfo: ClientDeviceInfo | null = null): Promise<DeviceInfo> {
    const ua = uaParserJs(req.headers['user-agent'])
    const ip = requestIp.getClientIp(req)

    const deviceInfo = new DeviceInfo()
    deviceInfo.setData(ip, ua, clientDeviceInfo, serverVersion, req.user?.id)

    if (clientDeviceInfo?.deviceId) {
      const existingDevice = await Database.deviceModel.getOldDeviceByDeviceId(clientDeviceInfo.deviceId)
      if (existingDevice) {
        if (existingDevice.update(deviceInfo)) {
          // cast(d): a device loaded from the database has its id
          await Database.deviceModel.updateFromOld(existingDevice as OldDeviceInfo)
        }
        return existingDevice
      }
    }

    // cast(d): setData sets the device id
    await Database.deviceModel.createFromOld(deviceInfo as OldDeviceInfo)

    return deviceInfo
  }

  async startSessionRequest(req: StartSessionRequest, res: Response, episodeId?: string | null) {
    const deviceInfo = await this.getDeviceInfo(req, req.body?.deviceInfo)
    Logger.debug(`[PlaybackSessionManager] startSessionRequest for device ${deviceInfo.deviceDescription}`)
    const { libraryItem, body: options } = req
    const session = await this.startSession(req.user, deviceInfo, libraryItem, episodeId, options)
    res.json(session.toJSONForClient(libraryItem))
  }

  async syncSessionRequest(user: User, session: PlaybackSession, payload: SyncData, res: Response) {
    if (await this.syncSession(user, session, payload)) {
      res.sendStatus(200)
    } else {
      res.sendStatus(500)
    }
  }

  async syncLocalSessionsRequest(req: PlaybackRequest, res: Response) {
    const deviceInfo = await this.getDeviceInfo(req, req.body?.deviceInfo)
    const user = req.user
    const sessions: LocalSessionJson[] = req.body.sessions || []

    const syncResults: Awaited<ReturnType<PlaybackSessionManager['syncLocalSession']>>[] = []
    for (const sessionJson of sessions) {
      Logger.info(`[PlaybackSessionManager] Syncing local session "${sessionJson.displayTitle}" (${sessionJson.id}) (updatedAt: ${sessionJson.updatedAt})`)
      const result = await this.syncLocalSession(user, sessionJson, deviceInfo)
      syncResults.push(result)
    }

    res.json({
      results: syncResults
    })
  }

  async syncLocalSession(user: User, sessionJson: LocalSessionJson, deviceInfo: DeviceInfo): Promise<{ id: string | null; success: boolean; progressSynced?: boolean; error?: string }> {
    // TODO: Combine libraryItem query with library query
    const libraryItem = await Database.libraryItemModel.getExpandedById(sessionJson.libraryItemId)
    // cast(d): isPodcast is checked just before
    const episode = sessionJson.episodeId && libraryItem && libraryItem.isPodcast ? (libraryItem.media as Podcast).podcastEpisodes.find((pe) => pe.id === sessionJson.episodeId) : null
    if (!libraryItem || (libraryItem.isPodcast && !episode)) {
      Logger.error(`[PlaybackSessionManager] syncLocalSession: Media item not found for session "${sessionJson.displayTitle}" (${sessionJson.id})`)
      return {
        id: sessionJson.id,
        success: false,
        error: 'Media item not found'
      }
    }

    const library = await Database.libraryModel.findByPk(libraryItem.libraryId)
    if (!library) {
      Logger.error(`[PlaybackSessionManager] syncLocalSession: Library not found for session "${sessionJson.displayTitle}" (${sessionJson.id})`)
      return {
        id: sessionJson.id,
        success: false,
        error: 'Library not found'
      }
    }

    sessionJson.userId = user.id
    sessionJson.serverVersion = serverVersion

    // TODO: Temp update local playback session id to uuidv4 & library item/book/episode ids
    if (sessionJson.id?.startsWith('play_local_')) {
      if (!this.oldPlaybackSessionMap[sessionJson.id]) {
        const newSessionId = uuidv4()
        this.oldPlaybackSessionMap[sessionJson.id] = newSessionId
        sessionJson.id = newSessionId
      } else {
        sessionJson.id = this.oldPlaybackSessionMap[sessionJson.id]
      }
    }
    if (sessionJson.libraryItemId !== libraryItem.id) {
      Logger.info(`[PlaybackSessionManager] Mapped old libraryItemId "${sessionJson.libraryItemId}" to ${libraryItem.id}`)
      sessionJson.libraryItemId = libraryItem.id
      sessionJson.bookId = episode ? null : libraryItem.media.id
    }
    if (!sessionJson.bookId && !episode) {
      sessionJson.bookId = libraryItem.media.id
    }
    if (episode && sessionJson.episodeId !== episode.id) {
      Logger.info(`[PlaybackSessionManager] Mapped old episodeId "${sessionJson.episodeId}" to ${episode.id}`)
      sessionJson.episodeId = episode.id
    }
    if (sessionJson.libraryId !== libraryItem.libraryId) {
      sessionJson.libraryId = libraryItem.libraryId
    }

    let session: PlaybackSession | null | false = await Database.getPlaybackSession(sessionJson.id)
    if (!session) {
      // New session from local
      session = new PlaybackSession(sessionJson)
      session.deviceInfo = deviceInfo

      if (session.mediaMetadata == null) {
        session.mediaMetadata = {}
      }
      // cast(d): the media metadata object (set just above when missing) indexed by key
      const mediaMetadata = session.mediaMetadata as Record<string, unknown>

      // Populate mediaMetadata with the current library items metadata for any keys not set by client
      const libraryItemMediaMetadata: Record<string, unknown> = libraryItem.media.oldMetadataToJSON()
      for (const key in libraryItemMediaMetadata) {
        if (mediaMetadata[key] === undefined) {
          mediaMetadata[key] = libraryItemMediaMetadata[key]
        }
      }

      if (session.displayTitle == null || session.displayTitle === '') {
        session.displayTitle = libraryItem.title
      }
      if (session.displayAuthor == null || session.displayAuthor === '') {
        session.displayAuthor = libraryItem.authorNamesFirstLast
      }
      session.duration = libraryItem.media.getPlaybackDuration(sessionJson.episodeId)

      Logger.debug(`[PlaybackSessionManager] Inserting new session for "${session.displayTitle}" (${session.id})`)
      await Database.createPlaybackSession(session)
    } else {
      session.currentTime = sessionJson.currentTime
      session.timeListening = sessionJson.timeListening
      session.updatedAt = sessionJson.updatedAt

      let jsDate = new Date(sessionJson.updatedAt)
      // cast(d): isNaN coerces the Date to its time value, as in the JS
      if (isNaN(jsDate as unknown as number)) {
        jsDate = new Date()
      }
      session.date = date.format(jsDate, 'YYYY-MM-DD')
      session.dayOfWeek = date.format(jsDate, 'dddd')

      Logger.debug(`[PlaybackSessionManager] Updated session for "${session.displayTitle}" (${session.id})`)
      await Database.updatePlaybackSession(session)
    }

    const result = {
      id: session.id,
      success: true,
      progressSynced: false
    }

    const mediaItemId = session.episodeId || libraryItem.media.id
    let userProgressForItem = user.getMediaProgress(mediaItemId)
    if (userProgressForItem) {
      // cast(d): a session without updatedAt (null) compares as 0, as in the JS
      if (userProgressForItem.updatedAt.valueOf() > (session.updatedAt as number)) {
        Logger.info(`[PlaybackSessionManager] Not updating progress for "${session.displayTitle}" because it has been updated more recently (${userProgressForItem.updatedAt.valueOf()} > ${session.updatedAt}) (incoming currentTime: ${session.currentTime}) (current currentTime: ${userProgressForItem.currentTime})`)
      } else {
        Logger.info(`[PlaybackSessionManager] Updating progress for "${session.displayTitle}" with current time ${session.currentTime} (previously ${userProgressForItem.currentTime})`)
        const updateResponse = await user.createUpdateMediaProgressFromPayload({
          libraryItemId: libraryItem.id,
          episodeId: session.episodeId,
          ...session.mediaProgressObject,
          markAsFinishedPercentComplete: library.librarySettings.markAsFinishedPercentComplete,
          markAsFinishedTimeRemaining: library.librarySettings.markAsFinishedTimeRemaining
        })
        result.progressSynced = !!updateResponse.mediaProgress
        if (result.progressSynced) {
          userProgressForItem = updateResponse.mediaProgress
        }
      }
    } else {
      Logger.info(`[PlaybackSessionManager] Creating new media progress for media item "${session.displayTitle}"`)
      const updateResponse = await user.createUpdateMediaProgressFromPayload({
        libraryItemId: libraryItem.id,
        episodeId: session.episodeId,
        ...session.mediaProgressObject,
        markAsFinishedPercentComplete: library.librarySettings.markAsFinishedPercentComplete,
        markAsFinishedTimeRemaining: library.librarySettings.markAsFinishedTimeRemaining
      })
      result.progressSynced = !!updateResponse.mediaProgress
      if (result.progressSynced) {
        userProgressForItem = updateResponse.mediaProgress
      }
    }

    // Update user and emit socket event
    if (result.progressSynced) {
      // cast(d) (2): progressSynced is only true when the media progress was set
      SocketAuthority.clientEmitter(user.id, 'user_item_progress_updated', {
        id: userProgressForItem!.id,
        sessionId: session.id,
        deviceDescription: session.deviceDescription,
        data: userProgressForItem!.getOldMediaProgress()
      })
    }

    return result
  }

  async syncLocalSessionRequest(req: PlaybackRequest, res: Response) {
    const deviceInfo = await this.getDeviceInfo(req, req.body?.deviceInfo)
    const sessionJson: LocalSessionJson = req.body
    const result = await this.syncLocalSession(req.user, sessionJson, deviceInfo)
    if (result.error) {
      res.status(500).send(result.error)
    } else {
      res.sendStatus(200)
    }
  }

  async closeSessionRequest(user: User, session: PlaybackSession, syncData: SyncData | null, res: Response) {
    await this.closeSession(user, session, syncData)
    res.sendStatus(200)
  }

  async startSession(user: User, deviceInfo: DeviceInfo, libraryItem: LibraryItem.LibraryItemExpanded, episodeId: string | null | undefined, options: StartSessionOptions): Promise<PlaybackSession> {
    // Close any sessions already open for user and device
    const userSessions = this.sessions.filter((playbackSession) => playbackSession.userId === user.id && playbackSession.deviceId === deviceInfo.id)
    for (const session of userSessions) {
      Logger.info(`[PlaybackSessionManager] startSession: Closing open session "${session.displayTitle}" for user "${user.username}" (Device: ${session.deviceDescription})`)
      await this.closeSession(user, session, null)
    }

    // cast(d): checkCanDirectPlay checks that supportedMimeTypes is an array
    const shouldDirectPlay = options.forceDirectPlay || (!options.forceTranscode && libraryItem.media.checkCanDirectPlay(options.supportedMimeTypes as string[], episodeId))
    const mediaPlayer = options.mediaPlayer || 'unknown'

    const mediaItemId = episodeId || libraryItem.media.id
    const userProgress = user.getMediaProgress(mediaItemId)
    let userStartTime = 0
    if (userProgress) {
      if (userProgress.isFinished) {
        Logger.info(`[PlaybackSessionManager] Starting session for user "${user.username}" and resetting progress for finished item "${libraryItem.media.title}"`)
        // Keep userStartTime as 0 so the client restarts the media
      } else {
        // cast(d): parseFloat converts the number to a string first, as in the JS
        userStartTime = Number.parseFloat(userProgress.currentTime as unknown as string) || 0
      }
    }
    const newPlaybackSession = new PlaybackSession()
    newPlaybackSession.setData(libraryItem, user.id, mediaPlayer, deviceInfo, userStartTime, episodeId)

    let audioTracks: (AudioTrackObject | PlaybackSession['audioTracks'][number])[] = []
    if (shouldDirectPlay) {
      Logger.debug(`[PlaybackSessionManager] "${user.username}" starting direct play session for item "${libraryItem.id}" with id ${newPlaybackSession.id} (Device: ${newPlaybackSession.deviceDescription})`)
      audioTracks = libraryItem.getTrackList(episodeId)
      newPlaybackSession.playMethod = PlayMethod.DIRECTPLAY
    } else {
      Logger.debug(`[PlaybackSessionManager] "${user.username}" starting stream session for item "${libraryItem.id}" (Device: ${newPlaybackSession.deviceDescription})`)
      // cast(d): setData sets the session id
      // cast(d): a request without an episode id passes undefined, which the stream stores as is
      const stream = new Stream(newPlaybackSession.id!, this.StreamsPath, user, libraryItem, episodeId as string | null, userStartTime)
      await stream.generatePlaylist()
      stream.start() // Start transcode

      audioTracks = [stream.getAudioTrack()]
      newPlaybackSession.stream = stream
      newPlaybackSession.playMethod = PlayMethod.TRANSCODE

      stream.on('closed', () => {
        Logger.debug(`[PlaybackSessionManager] Stream closed for session "${newPlaybackSession.id}" (Device: ${newPlaybackSession.deviceDescription})`)
        newPlaybackSession.stream = null
      })
    }
    // cast(d): direct play tracks are plain track objects; PlaybackSession types them as AudioTrack objects (its toJSON handles both)
    newPlaybackSession.audioTracks = audioTracks as PlaybackSession['audioTracks']

    this.sessions.push(newPlaybackSession)
    SocketAuthority.adminEmitter('user_stream_update', user.toJSONForPublic(this.sessions))

    return newPlaybackSession
  }

  async syncSession(user: User, session: PlaybackSession, syncData: SyncData): Promise<boolean> {
    // TODO: Combine libraryItem query with library query
    // cast(d): open sessions have a library item id (setData)
    const libraryItem = await Database.libraryItemModel.getExpandedById(session.libraryItemId!)
    if (!libraryItem) {
      Logger.error(`[PlaybackSessionManager] syncSession Library Item not found "${session.libraryItemId}"`)
      return false
    }

    const library = await Database.libraryModel.findByPk(libraryItem.libraryId)
    if (!library) {
      Logger.error(`[PlaybackSessionManager] syncSession Library not found "${libraryItem.libraryId}"`)
      return false
    }

    session.currentTime = syncData.currentTime
    session.addListeningTime(syncData.timeListened)
    Logger.debug(`[PlaybackSessionManager] syncSession "${session.id}" (Device: ${session.deviceDescription}) | Total Time Listened: ${session.timeListening}`)

    const updateResponse = await user.createUpdateMediaProgressFromPayload({
      libraryItemId: libraryItem.id,
      episodeId: session.episodeId,
      // duration no longer required (v2.15.1) but used if available
      duration: syncData.duration || session.duration || 0,
      currentTime: syncData.currentTime,
      progress: session.progress,
      markAsFinishedTimeRemaining: library.librarySettings.markAsFinishedTimeRemaining,
      markAsFinishedPercentComplete: library.librarySettings.markAsFinishedPercentComplete
    })
    if (updateResponse.mediaProgress) {
      SocketAuthority.clientEmitter(user.id, 'user_item_progress_updated', {
        id: updateResponse.mediaProgress.id,
        sessionId: session.id,
        deviceDescription: session.deviceDescription,
        data: updateResponse.mediaProgress.getOldMediaProgress()
      })
    }
    this.saveSession(session)

    return true
  }

  async closeSession(user: User, session: PlaybackSession, syncData: SyncData | null = null) {
    if (syncData) {
      await this.syncSession(user, session, syncData)
    } else {
      await this.saveSession(session)
    }
    Logger.debug(`[PlaybackSessionManager] closeSession "${session.id}"`)
    SocketAuthority.adminEmitter('user_stream_update', user.toJSONForPublic(this.sessions))
    SocketAuthority.clientEmitter(session.userId, 'user_session_closed', session.id)
    return this.removeSession(session.id)
  }

  saveSession(session: PlaybackSession) {
    if (!session.timeListening) return // Do not save a session with no listening time

    if (session.lastSave) {
      return Database.updatePlaybackSession(session)
    } else {
      session.lastSave = Date.now()
      return Database.createPlaybackSession(session)
    }
  }

  async removeSession(sessionId: string | null) {
    const session = this.sessions.find((s) => s.id === sessionId)
    if (!session) return
    if (session.stream) {
      await session.stream.close()
    }
    this.sessions = this.sessions.filter((s) => s.id !== sessionId)
    Logger.debug(`[PlaybackSessionManager] Removed session "${sessionId}"`)
  }

  /**
   * Remove all stream folders in `/metadata/streams`
   */
  async removeOrphanStreams() {
    try {
      await fs.ensureDir(this.StreamsPath)
    } catch (error) {
      // cast(d): catch variable is unknown
      Logger.error(`[PlaybackSessionManager] Failed to create streams directory at "${this.StreamsPath}": ${(error as Error).message}`)
      throw new Error(`[PlaybackSessionManager] Failed to create streams directory at "${this.StreamsPath}"`, { cause: error })
    }
    try {
      const streamsInPath = await fs.readdir(this.StreamsPath)
      for (const streamId of streamsInPath) {
        if (/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/.test(streamId)) {
          // Ensure is uuidv4
          const session = this.sessions.find((se) => se.id === streamId)
          if (!session) {
            const streamPath = Path.join(this.StreamsPath, streamId)
            Logger.debug(`[PlaybackSessionManager] Removing orphan stream "${streamPath}"`)
            await fs.remove(streamPath)
          }
        }
      }
    } catch (error) {
      Logger.error(`[PlaybackSessionManager] cleanOrphanStreams failed`, error)
    }
  }

  /**
   * Close all open sessions that have not been updated in the last 36 hours
   */
  async closeStaleOpenSessions() {
    const updatedAtTimeCutoff = Date.now() - 1000 * 60 * 60 * 36
    // cast(d): open sessions are created with setData (startSession), which sets updatedAt
    const staleSessions = this.sessions.filter((session) => session.updatedAt! < updatedAtTimeCutoff)
    for (const session of staleSessions) {
      // cast(d): set by setData (see above)
      const sessionLastUpdate = new Date(session.updatedAt!)
      Logger.info(`[PlaybackSessionManager] Closing stale session "${session.displayTitle}" (${session.id}) last updated at ${sessionLastUpdate}`)
      await this.removeSession(session.id)
    }
  }
}
export = PlaybackSessionManager
