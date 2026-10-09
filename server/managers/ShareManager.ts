import Database = require('../Database')
import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import LongTimeout = require('../utils/longTimeout')
import utils = require('../utils/index')
import type MediaItemShare = require('../models/MediaItemShare')
import type PlaybackSession = require('../objects/PlaybackSession')
const { elapsedPretty } = utils

interface OpenMediaItemShareObject {
  id: string
  mediaItemShare: MediaItemShare.MediaItemShareObject
  timeout?: LongTimeout
}

/**
 * Media item share object with the fields that are removed before it is sent to clients
 */
type MediaItemShareObjectForClient = MediaItemShare.MediaItemShareForClient & { pash?: string; userId?: string; extraData?: object | null }

class ShareManager {
  declare openMediaItemShares: OpenMediaItemShareObject[]
  declare openSharePlaybackSessions: PlaybackSession[]

  constructor() {
    this.openMediaItemShares = []

    this.openSharePlaybackSessions = []
  }

  init() {
    this.loadMediaItemShares()
  }

  addOpenSharePlaybackSession(playbackSession: PlaybackSession) {
    Logger.info(`[ShareManager] Adding new open share playback session "${playbackSession.displayTitle}"`)
    this.openSharePlaybackSessions.push(playbackSession)
  }

  closeSharePlaybackSession(playbackSession: PlaybackSession) {
    Logger.info(`[ShareManager] Closing share playback session "${playbackSession.displayTitle}"`)
    this.openSharePlaybackSessions = this.openSharePlaybackSessions.filter((s) => s.id !== playbackSession.id)
  }

  /**
   * Find an open media item share by media item ID
   */
  findByMediaItemId(mediaItemId: string): MediaItemShare.MediaItemShareForClient | null {
    const mediaItemShareObject = this.openMediaItemShares.find((s) => s.mediaItemShare.mediaItemId === mediaItemId)?.mediaItemShare
    if (mediaItemShareObject) {
      const mediaItemShareObjectForClient: MediaItemShareObjectForClient = { ...mediaItemShareObject }
      delete mediaItemShareObjectForClient.pash
      delete mediaItemShareObjectForClient.userId
      delete mediaItemShareObjectForClient.extraData
      return mediaItemShareObjectForClient
    }
    return null
  }

  /**
   * Find an open media item share by slug
   */
  findBySlug(slug: string): MediaItemShare.MediaItemShareForClient | null {
    const mediaItemShareObject = this.openMediaItemShares.find((s) => s.mediaItemShare.slug === slug)?.mediaItemShare
    if (mediaItemShareObject) {
      const mediaItemShareObjectForClient: MediaItemShareObjectForClient = { ...mediaItemShareObject }
      delete mediaItemShareObjectForClient.pash
      delete mediaItemShareObjectForClient.userId
      delete mediaItemShareObjectForClient.extraData
      return mediaItemShareObjectForClient
    }
    return null
  }

  findPlaybackSessionBySessionId(shareSessionId: string) {
    return this.openSharePlaybackSessions.find((s) => s.shareSessionId === shareSessionId)
  }

  /**
   * Load all media item shares from the database
   * Remove expired & schedule active
   */
  async loadMediaItemShares() {
    const mediaItemShares = await Database.models.mediaItemShare.findAll()

    for (const mediaItemShare of mediaItemShares) {
      if (mediaItemShare.expiresAt && mediaItemShare.expiresAt.valueOf() < Date.now()) {
        Logger.info(`[ShareManager] Removing expired media item share "${mediaItemShare.id}"`)
        await this.destroyMediaItemShare(mediaItemShare.id)
      } else if (mediaItemShare.expiresAt) {
        this.scheduleMediaItemShare(mediaItemShare)
      } else {
        Logger.info(`[ShareManager] Loaded permanent media item share "${mediaItemShare.id}"`)
        this.openMediaItemShares.push({
          id: mediaItemShare.id,
          mediaItemShare: mediaItemShare.toJSON()
        })
      }
    }
  }

  scheduleMediaItemShare(mediaItemShare: MediaItemShare) {
    if (!mediaItemShare?.expiresAt) return

    const expiresAtDuration = mediaItemShare.expiresAt.valueOf() - Date.now()
    if (expiresAtDuration <= 0) {
      Logger.warn(`[ShareManager] Attempted to schedule expired media item share "${mediaItemShare.id}"`)
      this.destroyMediaItemShare(mediaItemShare.id)
      return
    }
    const timeout = new LongTimeout()
    timeout.set(() => {
      Logger.info(`[ShareManager] Removing expired media item share "${mediaItemShare.id}"`)
      this.removeMediaItemShare(mediaItemShare.id)
    }, expiresAtDuration)
    this.openMediaItemShares.push({ id: mediaItemShare.id, mediaItemShare: mediaItemShare.toJSON(), timeout })
    Logger.info(`[ShareManager] Scheduled media item share "${mediaItemShare.id}" to expire in ${elapsedPretty(expiresAtDuration / 1000)}`)
  }

  openMediaItemShare(mediaItemShare: MediaItemShare) {
    if (mediaItemShare.expiresAt) {
      this.scheduleMediaItemShare(mediaItemShare)
    } else {
      this.openMediaItemShares.push({ id: mediaItemShare.id, mediaItemShare: mediaItemShare.toJSON() })
    }
    SocketAuthority.adminEmitter('share_open', mediaItemShare.toJSONForClient())
  }

  async removeMediaItemShare(mediaItemShareId: string) {
    const mediaItemShare = this.openMediaItemShares.find((s) => s.id === mediaItemShareId)
    if (!mediaItemShare) return

    if (mediaItemShare.timeout) {
      mediaItemShare.timeout.clear()
    }

    this.openMediaItemShares = this.openMediaItemShares.filter((s) => s.id !== mediaItemShareId)
    this.openSharePlaybackSessions = this.openSharePlaybackSessions.filter((s) => s.mediaItemShareId !== mediaItemShareId)
    await this.destroyMediaItemShare(mediaItemShareId)

    const mediaItemShareObjectForClient: MediaItemShareObjectForClient = { ...mediaItemShare.mediaItemShare }
    delete mediaItemShareObjectForClient.pash
    delete mediaItemShareObjectForClient.userId
    delete mediaItemShareObjectForClient.extraData
    SocketAuthority.adminEmitter('share_closed', mediaItemShareObjectForClient)
  }

  destroyMediaItemShare(mediaItemShareId: string) {
    return Database.models.mediaItemShare.destroy({ where: { id: mediaItemShareId } })
  }

  /**
   * Close open share sessions that have not been updated in the last 24 hours
   */
  closeStaleOpenShareSessions() {
    const updatedAtTimeCutoff = Date.now() - 1000 * 60 * 60 * 24
    // Open share sessions are created with setData, which sets updatedAt
    const staleSessions = this.openSharePlaybackSessions.filter((session) => session.updatedAt! < updatedAtTimeCutoff)
    for (const session of staleSessions) {
      // Set by setData (see above)
      const sessionLastUpdate = new Date(session.updatedAt!)
      Logger.info(`[PlaybackSessionManager] Closing stale session "${session.displayTitle}" (${session.id}) last updated at ${sessionLastUpdate}`)
      this.closeSharePlaybackSession(session)
    }
  }
}
export = new ShareManager()
