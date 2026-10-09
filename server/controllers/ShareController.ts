import type { Request, Response } from 'express'
import type { CreationAttributes, Model, ModelStatic } from 'sequelize'
import uuid = require('uuid')
import Path = require('path')
import sequelize = require('sequelize')
import Logger = require('../Logger')
import Database = require('../Database')

import constants = require('../utils/constants')
import fileUtils = require('../utils/fileUtils')
import zipHelpers = require('../utils/zipHelpers')

import PlaybackSession = require('../objects/PlaybackSession')
import ShareManager = require('../managers/ShareManager')
import type { RequestWithUser } from './types'

const { Op } = sequelize
const { PlayMethod } = constants
const { getAudioMimeTypeFromExtname, encodeUriPath } = fileUtils

type PublicRouter = import('../routers/PublicRouter')
type Book = import('../models/Book')
type LibraryItem = import('../models/LibraryItem')
type DeviceInfo = import('../objects/DeviceInfo')
type AudioTrack = import('../objects/files/AudioTrack')
import type MediaItemShare = require('../models/MediaItemShare')

/**
 * Media item share for the client; getMediaItemShareBySlug adds the share playback session
 */
type MediaItemShareWithSession = MediaItemShare.MediaItemShareForClient & { playbackSession?: ReturnType<PlaybackSession['toJSONForClient']> }

class ShareController {
  constructor() {}

  /**
   * Public route
   * GET: /api/share/:slug
   * Get media item share by slug
   */
  async getMediaItemShareBySlug(this: PublicRouter, req: Request, res: Response) {
    const { slug } = req.params
    // Optional start time
    // cast(d): isNaN coerces its argument (the query value is a string)
    // cast(d): query value
    let startTime = req.query.t && !isNaN(req.query.t as unknown as number) ? Math.max(0, parseInt(req.query.t as string)) : 0

    const mediaItemShare: MediaItemShareWithSession | null = ShareManager.findBySlug(slug)
    if (!mediaItemShare) {
      Logger.warn(`[ShareController] Media item share not found with slug ${slug}`)
      return res.sendStatus(404)
    }
    if (mediaItemShare.expiresAt && mediaItemShare.expiresAt.valueOf() < Date.now()) {
      ShareManager.removeMediaItemShare(mediaItemShare.id)
      return res.status(404).send('Media item share not found')
    }

    if (req.cookies.share_session_id) {
      const playbackSession = ShareManager.findPlaybackSessionBySessionId(req.cookies.share_session_id)

      if (playbackSession) {
        if (mediaItemShare.id === playbackSession.mediaItemShareId) {
          Logger.debug(`[ShareController] Found share playback session ${req.cookies.share_session_id}`)
          // If ?t was provided, override the cached currentTime
          // Non-null: share sessions are created with setData, which sets the duration
          if (startTime > 0 && startTime < playbackSession.duration!) {
            playbackSession.currentTime = startTime
          }
          mediaItemShare.playbackSession = playbackSession.toJSONForClient()
          return res.json(mediaItemShare)
        } else {
          // Changed media item share - close other session
          Logger.debug(`[ShareController] Other playback session is already open for share session. Closing session "${playbackSession.displayTitle}"`)
          ShareManager.closeSharePlaybackSession(playbackSession)
        }
      } else {
        Logger.info(`[ShareController] Share playback session not found with id ${req.cookies.share_session_id}`)
        if (!uuid.validate(req.cookies.share_session_id) || uuid.version(req.cookies.share_session_id) !== 4) {
          Logger.warn(`[ShareController] Invalid share session id ${req.cookies.share_session_id}`)
          res.clearCookie('share_session_id')
        }
      }
    }

    try {
      const libraryItem = await Database.mediaItemShareModel.getMediaItemsLibraryItem(mediaItemShare.mediaItemId, mediaItemShare.mediaItemType)
      if (!libraryItem) {
        return res.status(404).send('Media item not found')
      }

      let startOffset = 0
      // cast(d): getMediaItemsLibraryItem only returns book library items
      const publicTracks = (libraryItem.media as Book).includedAudioFiles.map((audioFile) => {
        const audioTrack = {
          index: audioFile.index,
          startOffset,
          duration: audioFile.duration,
          title: audioFile.metadata.filename || '',
          contentUrl: `${global.RouterBasePath}/public/share/${slug}/track/${audioFile.index}`,
          mimeType: audioFile.mimeType,
          codec: audioFile.codec || null,
          metadata: structuredClone(audioFile.metadata)
        }
        startOffset += audioTrack.duration
        return audioTrack
      })

      if (startTime > startOffset) {
        Logger.warn(`[ShareController] Start time ${startTime} is greater than total duration ${startOffset}`)
        startTime = 0
      }

      const shareSessionId = req.cookies.share_session_id || uuid.v4()
      const clientDeviceInfo = {
        clientName: 'Abs Web Share',
        deviceId: shareSessionId
      }
      // cast(d): getDeviceInfo reads req.user?.id, so this public request without a user works, but its parameter type requires a user
      const deviceInfo = await this.playbackSessionManager.getDeviceInfo(req as RequestWithUser, clientDeviceInfo)

      const newPlaybackSession = new PlaybackSession()
      // cast(d): share sessions have no user; setData stores the userId as is (the field is string | null), but its parameter is typed string
      ;(newPlaybackSession.setData as (libraryItem: LibraryItem, userId: string | null, mediaPlayer: string, deviceInfo: DeviceInfo | null, startTime: number) => void)(libraryItem, null, 'web-share', deviceInfo, startTime)
      // cast(d): share sessions keep plain track objects (toJSONForClient copies them with at.toJSON?.() || { ...at })
      newPlaybackSession.audioTracks = publicTracks as unknown as AudioTrack[]
      newPlaybackSession.playMethod = PlayMethod.DIRECTPLAY
      newPlaybackSession.shareSessionId = shareSessionId
      newPlaybackSession.mediaItemShareId = mediaItemShare.id
      // Non-null: getMediaItemsLibraryItem includes the library
      newPlaybackSession.coverAspectRatio = libraryItem.library!.settings.coverAspectRatio

      mediaItemShare.playbackSession = newPlaybackSession.toJSONForClient()
      ShareManager.addOpenSharePlaybackSession(newPlaybackSession)

      // 30 day cookie
      res.cookie('share_session_id', newPlaybackSession.shareSessionId, { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true })

      res.json(mediaItemShare)
    } catch (error) {
      Logger.error(`[ShareController] Failed`, error)
      res.status(500).send('Internal server error')
    }
  }

  /**
   * Public route - requires share_session_id cookie
   *
   * GET: /api/share/:slug/cover
   * Get media item share cover image
   */
  async getMediaItemShareCoverImage(req: Request, res: Response) {
    if (!req.cookies.share_session_id) {
      return res.status(404).send('Share session not set')
    }

    const { slug } = req.params

    const mediaItemShare = ShareManager.findBySlug(slug)
    if (!mediaItemShare) {
      return res.sendStatus(404)
    }

    const playbackSession = ShareManager.findPlaybackSessionBySessionId(req.cookies.share_session_id)
    if (!playbackSession || playbackSession.mediaItemShareId !== mediaItemShare.id) {
      return res.status(404).send('Share session not found')
    }

    const coverPath = playbackSession.coverPath
    if (!coverPath) {
      return res.status(404).send('Cover image not found')
    }

    if (global.XAccel) {
      const encodedURI = encodeUriPath(global.XAccel + coverPath)
      Logger.debug(`Use X-Accel to serve static file ${encodedURI}`)
      return res.status(204).header({ 'X-Accel-Redirect': encodedURI }).send()
    }

    res.sendFile(coverPath)
  }

  /**
   * Public route - requires share_session_id cookie
   *
   * GET: /api/share/:slug/track/:index
   * Get media item share audio track
   */
  async getMediaItemShareAudioTrack(req: Request, res: Response) {
    if (!req.cookies.share_session_id) {
      return res.status(404).send('Share session not set')
    }

    const { slug, index } = req.params

    const mediaItemShare = ShareManager.findBySlug(slug)
    if (!mediaItemShare) {
      return res.sendStatus(404)
    }

    const playbackSession = ShareManager.findPlaybackSessionBySessionId(req.cookies.share_session_id)
    if (!playbackSession || playbackSession.mediaItemShareId !== mediaItemShare.id) {
      return res.status(404).send('Share session not found')
    }

    const audioTrack = playbackSession.audioTracks.find((t) => t.index === parseInt(index))
    if (!audioTrack) {
      return res.status(404).send('Track not found')
    }
    // Non-null: share session tracks are built from the audio files with their metadata and path
    const audioTrackPath = audioTrack.metadata!.path!

    if (global.XAccel) {
      const encodedURI = encodeUriPath(global.XAccel + audioTrackPath)
      Logger.debug(`Use X-Accel to serve static file ${encodedURI}`)
      return res.status(204).header({ 'X-Accel-Redirect': encodedURI }).send()
    }

    // Express does not set the correct mimetype for m4b files so use our defined mimetypes if available
    const audioMimeType = getAudioMimeTypeFromExtname(Path.extname(audioTrackPath))
    if (audioMimeType) {
      res.setHeader('Content-Type', audioMimeType)
    }
    res.sendFile(audioTrackPath)
  }

  /**
   * Public route - requires share_session_id cookie
   *
   * GET: /api/share/:slug/download
   * Downloads media item share
   */
  async downloadMediaItemShare(req: Request, res: Response) {
    if (!req.cookies.share_session_id) {
      return res.status(404).send('Share session not set')
    }

    const { slug } = req.params
    const mediaItemShare = ShareManager.findBySlug(slug)
    if (!mediaItemShare) {
      return res.sendStatus(404)
    }
    if (!mediaItemShare.isDownloadable) {
      return res.status(403).send('Download is not allowed for this item')
    }

    const playbackSession = ShareManager.findPlaybackSessionBySessionId(req.cookies.share_session_id)
    if (!playbackSession || playbackSession.mediaItemShareId !== mediaItemShare.id) {
      return res.status(404).send('Share session not found')
    }

    // Non-null: share sessions are created with setData, which sets the library item id
    const libraryItem = await Database.libraryItemModel.findByPk(playbackSession.libraryItemId!, {
      attributes: ['id', 'path', 'relPath', 'isFile']
    })
    if (!libraryItem) {
      return res.status(404).send('Library item not found')
    }

    const itemPath = libraryItem.path
    const itemTitle = playbackSession.displayTitle

    Logger.info(`[ShareController] Requested download for book "${itemTitle}" at "${itemPath}"`)

    try {
      if (libraryItem.isFile) {
        const audioMimeType = getAudioMimeTypeFromExtname(Path.extname(itemPath))
        if (audioMimeType) {
          res.setHeader('Content-Type', audioMimeType)
        }
        await new Promise<void>((resolve, reject) => res.download(itemPath, libraryItem.relPath, (error) => (error ? reject(error) : resolve())))
      } else {
        const filename = `${itemTitle}.zip`
        await zipHelpers.zipDirectoryPipe(itemPath, filename, res)
      }

      Logger.info(`[ShareController] Downloaded item "${itemTitle}" at "${itemPath}"`)
    } catch (error) {
      Logger.error(`[ShareController] Download failed for item "${itemTitle}" at "${itemPath}"`, error)
      res.status(500).send('Failed to download the item')
    }
  }

  /**
   * Public route - requires share_session_id cookie
   *
   * PATCH: /api/share/:slug/progress
   * Update media item share progress
   */
  async updateMediaItemShareProgress(req: Request, res: Response) {
    if (!req.cookies.share_session_id) {
      return res.status(404).send('Share session not set')
    }

    const { slug } = req.params
    const { currentTime } = req.body
    if (currentTime === null || isNaN(currentTime) || currentTime < 0) {
      return res.status(400).send('Invalid current time')
    }

    const mediaItemShare = ShareManager.findBySlug(slug)
    if (!mediaItemShare) {
      return res.sendStatus(404)
    }

    const playbackSession = ShareManager.findPlaybackSessionBySessionId(req.cookies.share_session_id)
    if (!playbackSession || playbackSession.mediaItemShareId !== mediaItemShare.id) {
      return res.status(404).send('Share session not found')
    }

    // Non-null: share sessions are created with setData, which sets the duration
    playbackSession.currentTime = Math.min(currentTime, playbackSession.duration!)
    playbackSession.updatedAt = Date.now()
    Logger.debug(`[ShareController] Update share playback session ${req.cookies.share_session_id} currentTime: ${playbackSession.currentTime}`)
    res.sendStatus(204)
  }

  /**
   * POST: /api/share/mediaitem
   * Create a new media item share
   */
  async createMediaItemShare(req: RequestWithUser, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`[ShareController] Non-admin user "${req.user.username}" attempted to create item share`)
      return res.sendStatus(403)
    }

    const { slug, expiresAt, mediaItemType, mediaItemId, isDownloadable } = req.body

    if (!slug?.trim?.() || typeof mediaItemType !== 'string' || typeof mediaItemId !== 'string') {
      return res.status(400).send('Missing or invalid required fields')
    }
    if (expiresAt === null || isNaN(expiresAt) || expiresAt < 0) {
      return res.status(400).send('Invalid expiration date')
    }
    if (!['book', 'podcastEpisode'].includes(mediaItemType)) {
      return res.status(400).send('Invalid media item type')
    }

    try {
      // Check if the media item share already exists by slug or mediaItemId
      const existingMediaItemShare = await Database.mediaItemShareModel.findOne({
        where: {
          [Op.or]: [{ slug }, { mediaItemId }]
        }
      })
      if (existingMediaItemShare) {
        if (existingMediaItemShare.mediaItemId === mediaItemId) {
          return res.status(409).send('Item is already shared')
        } else {
          return res.status(409).send('Slug is already in use')
        }
      }

      // Check that media item exists
      const mediaItemModel: ModelStatic<Model> = mediaItemType === 'book' ? Database.bookModel : Database.podcastEpisodeModel
      const mediaItem = await mediaItemModel.findByPk(mediaItemId)
      if (!mediaItem) {
        return res.status(404).send('Media item not found')
      }

      const mediaItemShare = await Database.mediaItemShareModel.create(
        // NOTE: pash is not set, so the column is null although the MediaItemShare model types it as required (nothing reads it at the moment); expiresAt can be null although the model types it as Date
        // cast(c): the creation values have no pash and a nullable expiresAt
        {
          slug,
          expiresAt: expiresAt || null,
          mediaItemId,
          mediaItemType,
          userId: req.user.id,
          isDownloadable
        } as CreationAttributes<MediaItemShare>
      )

      ShareManager.openMediaItemShare(mediaItemShare)

      res.status(201).json(mediaItemShare?.toJSONForClient())
    } catch (error) {
      Logger.error(`[ShareController] Failed`, error)
      res.status(500).send('Internal server error')
    }
  }

  /**
   * DELETE: /api/share/mediaitem/:id
   * Delete media item share
   */
  async deleteMediaItemShare(req: RequestWithUser, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`[ShareController] Non-admin user "${req.user.username}" attempted to delete item share`)
      return res.sendStatus(403)
    }

    try {
      const mediaItemShare = await Database.mediaItemShareModel.findByPk(req.params.id)
      if (!mediaItemShare) {
        return res.status(404).send('Media item share not found')
      }

      ShareManager.removeMediaItemShare(mediaItemShare.id)

      await mediaItemShare.destroy()
      res.sendStatus(204)
    } catch (error) {
      Logger.error(`[ShareController] Failed`, error)
      res.status(500).send('Internal server error')
    }
  }
}
export = new ShareController()
