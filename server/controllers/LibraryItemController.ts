import type { Response, NextFunction } from 'express'
import type { Model } from 'sequelize'
import Path = require('path')
import fs = require('../libs/fsExtra')
import cron = require('../libs/nodeCron')
import uaParserJs = require('../libs/uaParser')
import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import Database = require('../Database')

import zipHelpers = require('../utils/zipHelpers')
import utils = require('../utils/index')
import constants = require('../utils/constants')
import fileUtils = require('../utils/fileUtils')
import LibraryItemScanner = require('../scanner/LibraryItemScanner')
import AudioFileScanner = require('../scanner/AudioFileScanner')
import Scanner = require('../scanner/Scanner')

import RssFeedManager = require('../managers/RssFeedManager')
import CacheManager = require('../managers/CacheManager')
import CoverManager = require('../managers/CoverManager')
import ShareManager = require('../managers/ShareManager')
import queryValue = require('../utils/queryValue')
import type { RequestWithUser } from './types'
import type { UploadedFile } from '../managers/types'

const { reqSupportsWebp, clampPositiveInt } = utils
const { ScanResult, AudioMimeType } = constants
const { getAudioMimeTypeFromExtname, encodeUriPath } = fileUtils
const { optionalString, requiredString } = queryValue

type ApiRouter = import('../routers/ApiRouter')
type Book = import('../models/Book')
type Podcast = import('../models/Podcast')
type LibraryFile = import('../objects/files/LibraryFile')
type EBookFileObject = import('../models/types').EBookFileObject
import type LibraryItem = require('../models/LibraryItem')

interface RequestEntityObject {
  libraryItem: LibraryItem.LibraryItemExpanded
}

interface RequestLibraryFileObject {
  libraryFile: LibraryFile
}

type LibraryItemControllerRequest = RequestWithUser & RequestEntityObject

type LibraryItemControllerRequestWithFile = RequestWithUser & RequestEntityObject & RequestLibraryFileObject

/** Upload request of POST /api/items/:id/cover (req.files from express-fileupload) */
type UploadCoverRequest = LibraryItemControllerRequest & { files?: { cover?: UploadedFile } }

/** Expanded item JSON with the optional entities findOne adds */
type LibraryItemJsonExpanded = ReturnType<LibraryItem['toOldJSONExpanded']> & {
  userMediaProgress?: ReturnType<RequestWithUser['user']['getOldMediaProgress']>
  rssFeed?: unknown
  mediaItemShare?: ReturnType<typeof ShareManager.findByMediaItemId>
  episodeDownloadsQueued?: unknown[]
  episodesDownloading?: unknown[]
}

type QuickMatchOptions = NonNullable<Parameters<typeof Scanner.quickMatchLibraryItem>[2]>

/** LibraryFile JSON made into the primary ebook file (isSupplementary and fileType deleted, ebookFormat added) */
type PrimaryEbookFileJson = Omit<ReturnType<LibraryFile['toJSON']>, 'isSupplementary' | 'fileType'> & {
  isSupplementary?: boolean | null
  fileType?: string
  ebookFormat?: string
}

/**
 * Enforce per-item access for batch item routes
 *
 * @returns true if the user may access every item; false if 403 was sent
 */
function ensureUserCanAccessLibraryItemsForBatch(req: RequestWithUser, res: Response, libraryItems: LibraryItem[]): boolean {
  for (const libraryItem of libraryItems) {
    if (!req.user.checkCanAccessLibraryItem(libraryItem)) {
      res.sendStatus(403)
      return false
    }
  }
  return true
}

class LibraryItemController {
  constructor() {}

  /**
   * GET: /api/items/:id
   * Optional query params:
   * ?include=progress,rssfeed,downloads,share
   * ?expanded=1
   */
  async findOne(this: ApiRouter, req: LibraryItemControllerRequest, res: Response) {
    // NOTE: a repeated query parameter is an array; .split then throws a TypeError, which in this async handler stops the server (see Bugs)
    const includeEntities = (optionalString(req.query.include) || '').split(',')
    // cast(d): query value compared with a number; == converts it ("1", ["1"], ...) itself, TypeScript only rejects the types
    if ((req.query.expanded as unknown) == 1) {
      const item: LibraryItemJsonExpanded = req.libraryItem.toOldJSONExpanded()

      // Include users media progress
      if (includeEntities.includes('progress')) {
        const episodeId = optionalString(req.query.episode) || null
        item.userMediaProgress = req.user.getOldMediaProgress(item.id, episodeId)
      }

      if (includeEntities.includes('rssfeed')) {
        const feedData = await RssFeedManager.findFeedForEntityId(item.id)
        item.rssFeed = feedData?.toOldJSONMinified() || null
      }

      if (item.mediaType === 'book' && req.user.isAdminOrUp && includeEntities.includes('share')) {
        item.mediaItemShare = ShareManager.findByMediaItemId(item.media.id)
      }

      if (item.mediaType === 'podcast' && includeEntities.includes('downloads')) {
        const downloadsInQueue = this.podcastManager.getEpisodeDownloadsInQueue(req.libraryItem.id)
        item.episodeDownloadsQueued = downloadsInQueue.map((d) => d.toJSONForClient())
        if (this.podcastManager.currentDownload?.libraryItemId === req.libraryItem.id) {
          item.episodesDownloading = [this.podcastManager.currentDownload.toJSONForClient()]
        }
      }

      return res.json(item)
    }
    res.json(req.libraryItem.toOldJSON())
  }

  /**
   * DELETE: /api/items/:id
   * Delete library item. Will delete from database and file system if hard delete is requested.
   * Optional query params:
   * ?hard=1
   */
  async delete(this: ApiRouter, req: LibraryItemControllerRequest, res: Response) {
    // cast(d): query value compared with a number; == converts it ("1", ["1"], ...) itself, TypeScript only rejects the types
    const hardDelete = (req.query.hard as unknown) == 1 // Delete from file system
    const libraryItemPath = req.libraryItem.path

    const mediaItemIds: string[] = []
    const authorIds: string[] = []
    const seriesIds: string[] = []
    if (req.libraryItem.isPodcast) {
      // cast(d): isPodcast is a getter and does not narrow media (Book | Podcast); this branch only runs for podcast items
      const podcast = req.libraryItem.media as Podcast
      mediaItemIds.push(...podcast.podcastEpisodes.map((ep) => ep.id))
    } else {
      // cast(d): isPodcast is a getter and does not narrow media (Book | Podcast); an item that is not a podcast is a book (mediaType is 'book' or 'podcast')
      const book = req.libraryItem.media as Book
      mediaItemIds.push(req.libraryItem.media.id)
      if (book.authors?.length) {
        authorIds.push(...book.authors.map((au) => au.id))
      }
      if (book.series?.length) {
        seriesIds.push(...book.series.map((se) => se.id))
      }
    }

    await this.handleDeleteLibraryItem(req.libraryItem.id, mediaItemIds, req.libraryItem.libraryId)
    if (hardDelete) {
      Logger.info(`[LibraryItemController] Deleting library item from file system at "${libraryItemPath}"`)
      await fs.remove(libraryItemPath).catch((error) => {
        Logger.error(`[LibraryItemController] Failed to delete library item from file system at "${libraryItemPath}"`, error)
      })
    }

    if (authorIds.length) {
      await this.checkRemoveAuthorsWithNoBooks(authorIds)
    }
    if (seriesIds.length) {
      await this.checkRemoveEmptySeries(seriesIds)
    }

    await Database.resetLibraryIssuesFilterData(req.libraryItem.libraryId)
    res.sendStatus(200)
  }

  static handleDownloadError(error: unknown, res: Response) {
    if (!res.headersSent) {
      // cast(d): the catch variable of the download (unknown); a file system error has a code, any other value reads undefined
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return res.status(404).send('File not found')
      } else {
        return res.status(500).send('Download failed')
      }
    }
  }

  /**
   * GET: /api/items/:id/download
   * Download library item. Zip file if multiple files.
   */
  async download(req: LibraryItemControllerRequest, res: Response) {
    if (!req.user.canDownload) {
      Logger.warn(`User "${req.user.username}" attempted to download without permission`)
      return res.sendStatus(403)
    }
    const libraryItemPath = req.libraryItem.path
    const itemTitle = req.libraryItem.media.title

    Logger.info(`[LibraryItemController] User "${req.user.username}" requested download for item "${itemTitle}" at "${libraryItemPath}"`)

    try {
      // If library item is a single file in root dir then no need to zip
      if (req.libraryItem.isFile) {
        // Express does not set the correct mimetype for m4b files so use our defined mimetypes if available
        const audioMimeType = getAudioMimeTypeFromExtname(Path.extname(libraryItemPath))
        if (audioMimeType) {
          res.setHeader('Content-Type', audioMimeType)
        }
        await new Promise<void>((resolve, reject) => res.download(libraryItemPath, req.libraryItem.relPath, (error) => (error ? reject(error) : resolve())))
      } else {
        const filename = `${itemTitle}.zip`
        await zipHelpers.zipDirectoryPipe(libraryItemPath, filename, res)
      }
      Logger.info(`[LibraryItemController] Downloaded item "${itemTitle}" at "${libraryItemPath}"`)
    } catch (error) {
      Logger.error(`[LibraryItemController] Download failed for item "${itemTitle}" at "${libraryItemPath}"`, error)
      LibraryItemController.handleDownloadError(error, res)
    }
  }

  /**
   * PATCH: /items/:id/media
   * Update media for a library item. Will create new authors & series when necessary
   */
  async updateMedia(this: ApiRouter, req: LibraryItemControllerRequest, res: Response) {
    const mediaPayload = req.body

    if (mediaPayload.url) {
      await LibraryItemController.prototype.uploadCover.bind(this)(req, res, false)
      if (res.writableEnded || res.headersSent) return
    }

    // Podcast specific
    let isPodcastAutoDownloadUpdated = false
    if (req.libraryItem.isPodcast) {
      // cast(d): isPodcast is a getter and does not narrow media (Book | Podcast); this branch only runs for podcast items
      const podcast = req.libraryItem.media as Podcast
      if (mediaPayload.autoDownloadEpisodes !== undefined && podcast.autoDownloadEpisodes !== mediaPayload.autoDownloadEpisodes) {
        isPodcastAutoDownloadUpdated = true
      } else if (mediaPayload.autoDownloadSchedule !== undefined && podcast.autoDownloadSchedule !== mediaPayload.autoDownloadSchedule) {
        isPodcastAutoDownloadUpdated = true
      }

      if (mediaPayload.autoDownloadSchedule && !cron.validate(mediaPayload.autoDownloadSchedule)) {
        Logger.error(`[LibraryItemController] Invalid auto download schedule cron expression "${mediaPayload.autoDownloadSchedule}" for library item "${req.libraryItem.media.title}"`)
        return res.status(400).send('Invalid auto download schedule cron expression')
      }
    }

    // cast(d): media is typed as the intersection of Book and Podcast per branch, whose two updateFromRequest signatures cannot be called; Book | Podcast can
    let hasUpdates = (await (req.libraryItem.media as Book | Podcast).updateFromRequest(mediaPayload)) || mediaPayload.url

    if (req.libraryItem.isBook && Array.isArray(mediaPayload.metadata?.series)) {
      // cast(d): isBook is a getter and does not narrow media (Book | Podcast); this block only runs for book items
      const book = req.libraryItem.media as Book
      const seriesUpdateData = await book.updateSeriesFromRequest(mediaPayload.metadata.series, req.libraryItem.libraryId)
      if (seriesUpdateData?.seriesRemoved.length) {
        // Check remove empty series
        Logger.debug(`[LibraryItemController] Series were removed from book. Check if series are now empty.`)
        await this.checkRemoveEmptySeries(seriesUpdateData.seriesRemoved.map((se) => se.id))
      }
      if (seriesUpdateData?.seriesAdded.length) {
        // Add series to filter data
        seriesUpdateData.seriesAdded.forEach((se) => {
          Database.addSeriesToFilterData(req.libraryItem.libraryId, se.name, se.id)
        })
      }
      if (seriesUpdateData?.hasUpdates) {
        hasUpdates = true
      }
    }

    if (req.libraryItem.isBook && Array.isArray(mediaPayload.metadata?.authors)) {
      // cast(d): isBook is a getter and does not narrow media (Book | Podcast); this block only runs for book items
      const book = req.libraryItem.media as Book
      const authorNames = mediaPayload.metadata.authors.map((au: { name?: unknown }) => (typeof au.name === 'string' ? au.name.trim() : null)).filter((au: string | null) => au)
      const authorUpdateData = await book.updateAuthorsFromRequest(authorNames, req.libraryItem.libraryId)
      if (authorUpdateData?.authorsRemoved.length) {
        // Check remove empty authors
        Logger.debug(`[LibraryItemController] Authors were removed from book. Check if authors are now empty.`)
        await this.checkRemoveAuthorsWithNoBooks(authorUpdateData.authorsRemoved.map((au) => au.id))
        hasUpdates = true
      }
      if (authorUpdateData?.authorsAdded.length) {
        // Add authors to filter data
        authorUpdateData.authorsAdded.forEach((au) => {
          Database.addAuthorToFilterData(req.libraryItem.libraryId, au.name, au.id)
        })
        hasUpdates = true
      }
    }

    if (hasUpdates) {
      req.libraryItem.changed('updatedAt', true)
      await req.libraryItem.save()

      await req.libraryItem.saveMetadataFile()

      if (isPodcastAutoDownloadUpdated) {
        // cast(d): isPodcastAutoDownloadUpdated is only set in the isPodcast branch above, so this is a podcast item
        this.cronManager.checkUpdatePodcastCron(req.libraryItem as LibraryItem.PodcastLibraryItem)
      }

      Logger.debug(`[LibraryItemController] Updated library item media ${req.libraryItem.media.title}`)
      SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
    }
    res.json({
      updated: hasUpdates,
      libraryItem: req.libraryItem.toOldJSON()
    })
  }

  /**
   * POST: /api/items/:id/cover
   *
   * @param [updateAndReturnJson=true] - Allows the function to be used for both direct API calls and internally
   */
  async uploadCover(req: UploadCoverRequest, res: Response, updateAndReturnJson = true) {
    if (!req.user.canUpload) {
      Logger.warn(`User "${req.user.username}" attempted to upload a cover without permission`)
      return res.sendStatus(403)
    }

    let result: Awaited<ReturnType<typeof CoverManager.uploadCover>> | null = null
    if (req.body?.url) {
      Logger.debug(`[LibraryItemController] Requesting download cover from url "${req.body.url}"`)
      result = await CoverManager.downloadCoverFromUrlNew(req.body.url, req.libraryItem.id, req.libraryItem.isFile ? null : req.libraryItem.path)
    } else if (req.files?.cover) {
      Logger.debug(`[LibraryItemController] Handling uploaded cover`)
      result = await CoverManager.uploadCover(req.libraryItem, req.files.cover)
    } else {
      return res.status(400).send('Invalid request no file or url')
    }

    if (result?.error) {
      return res.status(400).send(result.error)
    } else if (!result?.cover) {
      return res.status(500).send('Unknown error occurred')
    }

    req.libraryItem.media.coverPath = result.cover
    // cast(b): Book and Podcast both have the coverPath column; TypeScript cannot call the overloaded changed() on the union of the two models, so the type names only a model with that column
    ;(req.libraryItem.media as Model & { coverPath: string | null }).changed('coverPath', true)
    // cast(b): TypeScript cannot call save() on the union of the two models (Book | Podcast); both are Sequelize models
    await (req.libraryItem.media as Book | Podcast).save()

    if (updateAndReturnJson) {
      // client uses updatedAt timestamp in URL to force refresh cover
      req.libraryItem.changed('updatedAt', true)
      await req.libraryItem.save()

      SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
      res.json({
        success: true,
        cover: result.cover
      })
    }
  }

  /**
   * PATCH: /api/items/:id/cover
   *
   * This is used when updating the cover to a local image library file for the library item
   * TODO: In the next API this should be using an inode or similar instead of a file path
   */
  async updateCover(req: LibraryItemControllerRequest, res: Response) {
    if (!req.body.cover) {
      return res.status(400).send('Invalid request no cover path')
    }

    // Must be a cover file path inside the libraryFiles array
    const validationResult = await CoverManager.validateCoverPath(req.body.cover, req.libraryItem)
    if (validationResult.error) {
      return res.status(500).send(validationResult.error)
    }
    // cast(d): validateCoverPath returns { error } with a non-empty message or { cover, updated }; the error result returned above
    const validCoverResult = validationResult as { cover: string; updated: boolean }
    if (validCoverResult.updated) {
      req.libraryItem.media.coverPath = validCoverResult.cover
      // cast(b): Book and Podcast both have the coverPath column; TypeScript cannot call the overloaded changed() on the union of the two models, so the type names only a model with that column
      ;(req.libraryItem.media as Model & { coverPath: string | null }).changed('coverPath', true)
      // cast(b): TypeScript cannot call save() on the union of the two models (Book | Podcast); both are Sequelize models
      await (req.libraryItem.media as Book | Podcast).save()

      // client uses updatedAt timestamp in URL to force refresh cover
      req.libraryItem.changed('updatedAt', true)
      await req.libraryItem.save()

      SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
    }
    res.json({
      success: true,
      cover: validationResult.cover
    })
  }

  /**
   * DELETE: /api/items/:id/cover
   */
  async removeCover(req: LibraryItemControllerRequest, res: Response) {
    if (req.libraryItem.media.coverPath) {
      req.libraryItem.media.coverPath = null
      // cast(b): Book and Podcast both have the coverPath column; TypeScript cannot call the overloaded changed() on the union of the two models, so the type names only a model with that column
      ;(req.libraryItem.media as Model & { coverPath: string | null }).changed('coverPath', true)
      // cast(b): TypeScript cannot call save() on the union of the two models (Book | Podcast); both are Sequelize models
      await (req.libraryItem.media as Book | Podcast).save()

      // client uses updatedAt timestamp in URL to force refresh cover
      req.libraryItem.changed('updatedAt', true)
      await req.libraryItem.save()

      await CacheManager.purgeCoverCache(req.libraryItem.id)

      SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
    }

    res.sendStatus(200)
  }

  /**
   * GET: /api/items/:id/cover
   */
  async getCover(req: RequestWithUser, res: Response) {
    const {
      query: { width, height, format, raw }
    } = req

    if (req.query.ts) res.set('Cache-Control', 'private, max-age=86400')

    const libraryItemId = req.params.id
    if (!libraryItemId) {
      return res.sendStatus(400)
    }

    if (raw) {
      const coverPath = await Database.libraryItemModel.getCoverPath(libraryItemId)
      if (!coverPath || !(await fs.pathExists(coverPath))) {
        return res.sendStatus(404)
      }
      // any value
      if (global.XAccel) {
        const encodedURI = encodeUriPath(global.XAccel + coverPath)
        Logger.debug(`Use X-Accel to serve static file ${encodedURI}`)
        return res.status(204).header({ 'X-Accel-Redirect': encodedURI }).send()
      }
      return res.sendFile(coverPath)
    }

    const options = {
      format: optionalString(format) || (reqSupportsWebp(req) ? 'webp' : 'jpeg'),
      height: clampPositiveInt(height ? parseInt(requiredString(height)) : null, 4096),
      width: clampPositiveInt(width ? parseInt(requiredString(width)) : null, 4096)
    }
    return CacheManager.handleCoverCache(res, libraryItemId, options)
  }

  /**
   * POST: /api/items/:id/play
   */
  startPlaybackSession(this: ApiRouter, req: LibraryItemControllerRequest, res: Response) {
    if (!req.libraryItem.hasAudioTracks) {
      Logger.error(`[LibraryItemController] startPlaybackSession cannot playback ${req.libraryItem.id}`)
      return res.sendStatus(404)
    }

    this.playbackSessionManager.startSessionRequest(req, res, null)
  }

  /**
   * POST: /api/items/:id/play/:episodeId
   */
  startEpisodePlaybackSession(this: ApiRouter, req: LibraryItemControllerRequest, res: Response) {
    if (!req.libraryItem.isPodcast) {
      Logger.error(`[LibraryItemController] startEpisodePlaybackSession invalid media type ${req.libraryItem.id}`)
      return res.sendStatus(400)
    }
    // cast(d): isPodcast is a getter and does not narrow media (Book | Podcast); a non-podcast item returned 400 above
    const podcast = req.libraryItem.media as Podcast

    const episodeId = req.params.episodeId
    if (!podcast.podcastEpisodes.some((ep) => ep.id === episodeId)) {
      Logger.error(`[LibraryItemController] startPlaybackSession episode ${episodeId} not found for item ${req.libraryItem.id}`)
      return res.sendStatus(404)
    }

    this.playbackSessionManager.startSessionRequest(req, res, episodeId)
  }

  /**
   * PATCH: /api/items/:id/tracks
   */
  async updateTracks(req: LibraryItemControllerRequest, res: Response) {
    const orderedFileData = req.body?.orderedFileData

    if (!req.libraryItem.isBook) {
      Logger.error(`[LibraryItemController] updateTracks invalid media type ${req.libraryItem.id}`)
      return res.sendStatus(400)
    }
    // cast(d): isBook is a getter and does not narrow media (Book | Podcast); a non-book item returned 400 above
    const book = req.libraryItem.media as Book
    if (!Array.isArray(orderedFileData) || !orderedFileData.length) {
      Logger.error(`[LibraryItemController] updateTracks invalid orderedFileData ${req.libraryItem.id}`)
      return res.sendStatus(400)
    }
    // Ensure that each orderedFileData has a valid ino and is in the book audioFiles
    if (orderedFileData.some((fileData) => !fileData?.ino || !book.audioFiles.some((af) => af.ino === fileData.ino))) {
      Logger.error(`[LibraryItemController] updateTracks invalid orderedFileData ${req.libraryItem.id}`)
      return res.sendStatus(400)
    }

    let index = 1
    const updatedAudioFiles = orderedFileData.map((fileData) => {
      // Non-null: the check above returned 400 unless every orderedFileData ino is in the book audioFiles
      const audioFile = book.audioFiles.find((af) => af.ino === fileData.ino)!
      audioFile.manuallyVerified = true
      audioFile.exclude = !!fileData.exclude
      if (audioFile.exclude) {
        audioFile.index = -1
      } else {
        audioFile.index = index++
      }
      return audioFile
    })
    updatedAudioFiles.sort((a, b) => a.index - b.index)

    book.audioFiles = updatedAudioFiles
    book.changed('audioFiles', true)
    await book.save()

    SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
    res.json(req.libraryItem.toOldJSON())
  }

  /**
   * POST /api/items/:id/match
   */
  async match(this: ApiRouter, req: LibraryItemControllerRequest, res: Response) {
    const reqBody = req.body || {}

    const options: QuickMatchOptions = {}
    const matchOptions: ('provider' | 'title' | 'author' | 'isbn' | 'asin')[] = ['provider', 'title', 'author', 'isbn', 'asin']
    for (const key of matchOptions) {
      if (reqBody[key] && typeof reqBody[key] === 'string') {
        options[key] = reqBody[key]
      }
    }
    if (reqBody.overrideCover !== undefined) {
      options.overrideCover = !!reqBody.overrideCover
    }
    if (reqBody.overrideDetails !== undefined) {
      options.overrideDetails = !!reqBody.overrideDetails
    }

    const matchResult = await Scanner.quickMatchLibraryItem(this, req.libraryItem, options)
    res.json(matchResult)
  }

  /**
   * POST: /api/items/batch/delete
   * Batch delete library items. Will delete from database and file system if hard delete is requested.
   * Optional query params:
   * ?hard=1
   */
  async batchDelete(this: ApiRouter, req: RequestWithUser, res: Response) {
    if (!req.user.canDelete) {
      Logger.warn(`[LibraryItemController] User "${req.user.username}" attempted to delete without permission`)
      return res.sendStatus(403)
    }
    // cast(d): query value compared with a number; == converts it ("1", ["1"], ...) itself, TypeScript only rejects the types
    const hardDelete = (req.query.hard as unknown) == 1 // Delete files from filesystem

    const { libraryItemIds } = req.body
    if (!libraryItemIds?.length || !Array.isArray(libraryItemIds)) {
      return res.status(400).send('Invalid request body')
    }

    const itemsToDelete = await Database.libraryItemModel.findAllExpandedWhere({
      id: libraryItemIds
    })

    if (!itemsToDelete.length) {
      return res.sendStatus(404)
    }

    // Ensure user has permission to delete these library items
    if (!ensureUserCanAccessLibraryItemsForBatch(req, res, itemsToDelete)) {
      return
    }

    const libraryId = itemsToDelete[0].libraryId

    for (const libraryItem of itemsToDelete) {
      const libraryItemPath = libraryItem.path
      Logger.info(`[LibraryItemController] (${hardDelete ? 'Hard' : 'Soft'}) deleting Library Item "${libraryItem.media.title}" with id "${libraryItem.id}"`)
      const mediaItemIds: string[] = []
      const seriesIds: string[] = []
      const authorIds: string[] = []
      if (libraryItem.isPodcast) {
        // cast(d): isPodcast is a getter and does not narrow media (Book | Podcast); this branch only runs for podcast items
        const podcast = libraryItem.media as Podcast
        mediaItemIds.push(...podcast.podcastEpisodes.map((ep) => ep.id))
      } else {
        mediaItemIds.push(libraryItem.media.id)
        // cast(d): isPodcast is a getter and does not narrow media (Book | Podcast); an item that is not a podcast is a book (mediaType is 'book' or 'podcast')
        const book = libraryItem.media as Book
        if (book.series?.length) {
          seriesIds.push(...book.series.map((se) => se.id))
        }
        if (book.authors?.length) {
          authorIds.push(...book.authors.map((au) => au.id))
        }
      }
      await this.handleDeleteLibraryItem(libraryItem.id, mediaItemIds, libraryItem.libraryId)
      if (hardDelete) {
        Logger.info(`[LibraryItemController] Deleting library item from file system at "${libraryItemPath}"`)
        await fs.remove(libraryItemPath).catch((error) => {
          Logger.error(`[LibraryItemController] Failed to delete library item from file system at "${libraryItemPath}"`, error)
        })
      }
      if (seriesIds.length) {
        await this.checkRemoveEmptySeries(seriesIds)
      }
      if (authorIds.length) {
        await this.checkRemoveAuthorsWithNoBooks(authorIds)
      }
    }

    await Database.resetLibraryIssuesFilterData(libraryId)

    res.sendStatus(200)
  }

  /**
   * POST: /api/items/batch/update
   */
  async batchUpdate(this: ApiRouter, req: RequestWithUser, res: Response) {
    if (!req.user.canUpdate) {
      Logger.warn(`[LibraryItemController] User "${req.user.username}" attempted to batch update without permission`)
      return res.sendStatus(403)
    }

    const updatePayloads = req.body
    if (!Array.isArray(updatePayloads) || !updatePayloads.length) {
      Logger.error(`[LibraryItemController] Batch update failed. Invalid payload`)
      return res.sendStatus(400)
    }

    // Ensure that each update payload has a unique library item id
    const libraryItemIds = [...new Set(updatePayloads.map((up) => up?.id).filter((id) => id))]
    if (!libraryItemIds.length || libraryItemIds.length !== updatePayloads.length) {
      Logger.error(`[LibraryItemController] Batch update failed. Each update payload must have a unique library item id`)
      return res.sendStatus(400)
    }

    // Get all library items to update
    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({
      id: libraryItemIds
    })
    if (updatePayloads.length !== libraryItems.length) {
      Logger.error(`[LibraryItemController] Batch update failed. Not all library items found`)
      return res.sendStatus(404)
    }

    // Ensure user has permission to update these library items
    if (!ensureUserCanAccessLibraryItemsForBatch(req, res, libraryItems)) {
      return
    }

    let itemsUpdated = 0

    const seriesIdsRemoved: string[] = []
    const authorIdsRemoved: string[] = []

    for (const updatePayload of updatePayloads) {
      const mediaPayload = updatePayload.mediaPayload
      // Non-null: every payload has a unique id (checked above) and as many items as payloads were found, so each id has its item
      const libraryItem = libraryItems.find((li) => li.id === updatePayload.id)!

      if (libraryItem.isPodcast && mediaPayload.autoDownloadSchedule && !cron.validate(mediaPayload.autoDownloadSchedule)) {
        Logger.warn(`[LibraryItemController] Invalid auto download schedule cron expression "${mediaPayload.autoDownloadSchedule}" for library item "${libraryItem.media.title}" - skipping update`)
        continue
      }

      // cast(d): media is typed as the intersection of Book and Podcast per branch, whose two updateFromRequest signatures cannot be called; Book | Podcast can
      let hasUpdates = await (libraryItem.media as Book | Podcast).updateFromRequest(mediaPayload)

      if (libraryItem.isBook && Array.isArray(mediaPayload.metadata?.series)) {
        // cast(d): isBook is a getter and does not narrow media (Book | Podcast); this block only runs for book items
        const book = libraryItem.media as Book
        const seriesUpdateData = await book.updateSeriesFromRequest(mediaPayload.metadata.series, libraryItem.libraryId)
        if (seriesUpdateData?.seriesRemoved.length) {
          seriesIdsRemoved.push(...seriesUpdateData.seriesRemoved.map((se) => se.id))
        }
        if (seriesUpdateData?.seriesAdded.length) {
          seriesUpdateData.seriesAdded.forEach((se) => {
            Database.addSeriesToFilterData(libraryItem.libraryId, se.name, se.id)
          })
        }
        if (seriesUpdateData?.hasUpdates) {
          hasUpdates = true
        }
      }

      if (libraryItem.isBook && Array.isArray(mediaPayload.metadata?.authors)) {
        // cast(d): isBook is a getter and does not narrow media (Book | Podcast); this block only runs for book items
        const book = libraryItem.media as Book
        const authorNames = mediaPayload.metadata.authors.map((au: { name?: unknown }) => (typeof au.name === 'string' ? au.name.trim() : null)).filter((au: string | null) => au)
        const authorUpdateData = await book.updateAuthorsFromRequest(authorNames, libraryItem.libraryId)
        if (authorUpdateData?.authorsRemoved.length) {
          authorIdsRemoved.push(...authorUpdateData.authorsRemoved.map((au) => au.id))
          hasUpdates = true
        }
        if (authorUpdateData?.authorsAdded.length) {
          authorUpdateData.authorsAdded.forEach((au) => {
            Database.addAuthorToFilterData(libraryItem.libraryId, au.name, au.id)
          })
          hasUpdates = true
        }
      }

      if (hasUpdates) {
        libraryItem.changed('updatedAt', true)
        await libraryItem.save()

        await libraryItem.saveMetadataFile()

        Logger.debug(`[LibraryItemController] Updated library item media "${libraryItem.media.title}"`)
        SocketAuthority.libraryItemEmitter('item_updated', libraryItem)
        itemsUpdated++
      }
    }

    if (seriesIdsRemoved.length) {
      await this.checkRemoveEmptySeries(seriesIdsRemoved)
    }
    if (authorIdsRemoved.length) {
      await this.checkRemoveAuthorsWithNoBooks(authorIdsRemoved)
    }

    res.json({
      success: true,
      updates: itemsUpdated
    })
  }

  /**
   * POST: /api/items/batch/get
   */
  async batchGet(req: RequestWithUser, res: Response) {
    const libraryItemIds = req.body.libraryItemIds || []
    if (!libraryItemIds.length) {
      return res.status(403).send('Invalid payload')
    }
    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({
      id: libraryItemIds
    })
    // Ensure user has permission to access these library items
    if (!ensureUserCanAccessLibraryItemsForBatch(req, res, libraryItems)) {
      return
    }
    res.json({
      libraryItems: libraryItems.map((li) => li.toOldJSONExpanded())
    })
  }

  /**
   * POST: /api/items/batch/quickmatch
   */
  async batchQuickMatch(this: ApiRouter, req: RequestWithUser, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.warn(`Non-admin user "${req.user.username}" other than admin attempted to batch quick match library items`)
      return res.sendStatus(403)
    }

    let itemsUpdated = 0
    let itemsUnmatched = 0

    if (!req.body.libraryItemIds?.length) {
      return res.sendStatus(400)
    }

    const libraryItems = await Database.libraryItemModel.findAllExpandedWhere({
      id: req.body.libraryItemIds
    })
    if (!libraryItems?.length) {
      return res.sendStatus(400)
    }

    res.sendStatus(200)

    const reqBodyOptions = req.body.options || {}
    const options: QuickMatchOptions = {}
    if (reqBodyOptions.provider && typeof reqBodyOptions.provider === 'string') {
      options.provider = reqBodyOptions.provider
    }
    if (reqBodyOptions.overrideCover !== undefined) {
      options.overrideCover = !!reqBodyOptions.overrideCover
    }
    if (reqBodyOptions.overrideDetails !== undefined) {
      options.overrideDetails = !!reqBodyOptions.overrideDetails
    }

    for (const libraryItem of libraryItems) {
      const matchResult = await Scanner.quickMatchLibraryItem(this, libraryItem, options)
      if (matchResult.updated) {
        itemsUpdated++
      } else if (matchResult.warning) {
        itemsUnmatched++
      }
    }

    const result = {
      success: itemsUpdated > 0,
      updates: itemsUpdated,
      unmatched: itemsUnmatched
    }
    SocketAuthority.clientEmitter(req.user.id, 'batch_quickmatch_complete', result)
  }

  /**
   * POST: /api/items/batch/scan
   */
  async batchScan(req: RequestWithUser, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.warn(`Non-admin user "${req.user.username}" other than admin attempted to batch scan library items`)
      return res.sendStatus(403)
    }

    if (!req.body.libraryItemIds?.length) {
      return res.sendStatus(400)
    }

    const libraryItems = await Database.libraryItemModel.findAll({
      where: {
        id: req.body.libraryItemIds
      },
      attributes: ['id', 'libraryId', 'isFile']
    })
    if (!libraryItems?.length) {
      return res.sendStatus(400)
    }

    res.sendStatus(200)

    const libraryId = libraryItems[0].libraryId
    for (const libraryItem of libraryItems) {
      if (libraryItem.isFile) {
        Logger.warn(`[LibraryItemController] Re-scanning file library items not yet supported`)
      } else {
        await LibraryItemScanner.scanLibraryItem(libraryItem.id)
      }
    }

    await Database.resetLibraryIssuesFilterData(libraryId)
  }

  /**
   * POST: /api/items/:id/scan
   */
  async scan(req: LibraryItemControllerRequest, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`[LibraryItemController] Non-admin user "${req.user.username}" attempted to scan library item`)
      return res.sendStatus(403)
    }

    if (req.libraryItem.isFile) {
      Logger.error(`[LibraryItemController] Re-scanning file library items not yet supported`)
      return res.sendStatus(500)
    }

    const result = await LibraryItemScanner.scanLibraryItem(req.libraryItem.id)
    await Database.resetLibraryIssuesFilterData(req.libraryItem.libraryId)
    const scanResultValues: Record<string, number> = ScanResult
    res.json({
      result: Object.keys(ScanResult).find((key) => scanResultValues[key] == result)
    })
  }

  /**
   * GET: /api/items/:id/metadata-object
   */
  getMetadataObject(this: ApiRouter, req: LibraryItemControllerRequest, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`[LibraryItemController] Non-admin user "${req.user.username}" attempted to get metadata object`)
      return res.sendStatus(403)
    }

    // cast(d): isBook is a getter and does not narrow media (Book | Podcast); the read only runs after !isBook is false (cast at the use site, the read is part of the condition)
    if (req.libraryItem.isMissing || !req.libraryItem.isBook || !(req.libraryItem.media as Book).includedAudioFiles.length) {
      Logger.error(`[LibraryItemController] getMetadataObject: Invalid library item "${req.libraryItem.media.title}"`)
      return res.sendStatus(400)
    }

    // cast(d): isBook is a getter and does not narrow the item; a non-book item returned 400 above
    res.json(this.audioMetadataManager.getMetadataObjectForApi(req.libraryItem as LibraryItem.BookLibraryItem))
  }

  /**
   * POST: /api/items/:id/chapters
   */
  async updateMediaChapters(req: LibraryItemControllerRequest, res: Response) {
    if (!req.user.canUpdate) {
      Logger.error(`[LibraryItemController] User "${req.user.username}" attempted to update chapters with invalid permissions`)
      return res.sendStatus(403)
    }

    if (req.libraryItem.isMissing || !req.libraryItem.isBook || !req.libraryItem.media.hasAudioTracks) {
      Logger.error(`[LibraryItemController] Invalid library item`)
      return res.sendStatus(500)
    }
    // cast(d): isBook is a getter and does not narrow media (Book | Podcast); a non-book item returned 500 above
    const book = req.libraryItem.media as Book

    if (!Array.isArray(req.body.chapters) || req.body.chapters.some((c: { title?: unknown; start?: unknown; end?: unknown }) => !c.title || typeof c.title !== 'string' || c.start === undefined || typeof c.start !== 'number' || c.end === undefined || typeof c.end !== 'number')) {
      Logger.error(`[LibraryItemController] Invalid payload`)
      return res.sendStatus(400)
    }

    const chapters = req.body.chapters || []

    let hasUpdates = false
    if (chapters.length !== book.chapters.length) {
      book.chapters = chapters.map((c: { title: string; start: number; end: number }, index: number) => {
        return {
          id: index,
          title: c.title,
          start: c.start,
          end: c.end
        }
      })
      hasUpdates = true
    } else {
      for (const [index, chapter] of chapters.entries()) {
        const currentChapter = book.chapters[index]
        if (currentChapter.title !== chapter.title || currentChapter.start !== chapter.start || currentChapter.end !== chapter.end) {
          currentChapter.title = chapter.title
          currentChapter.start = chapter.start
          currentChapter.end = chapter.end
          hasUpdates = true
        }
      }
    }

    if (hasUpdates) {
      book.changed('chapters', true)
      await book.save()

      await req.libraryItem.saveMetadataFile()

      SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
    }

    res.json({
      success: true,
      updated: hasUpdates
    })
  }

  /**
   * GET: /api/items/:id/ffprobe/:fileid
   * FFProbe JSON result from audio file
   */
  async getFFprobeData(req: LibraryItemControllerRequest, res: Response) {
    if (!req.user.isAdminOrUp) {
      Logger.error(`[LibraryItemController] Non-admin user "${req.user.username}" attempted to get ffprobe data`)
      return res.sendStatus(403)
    }

    const audioFile = req.libraryItem.getAudioFileWithIno(req.params.fileid)
    if (!audioFile) {
      Logger.error(`[LibraryItemController] Audio file not found with inode value ${req.params.fileid}`)
      return res.sendStatus(404)
    }

    const ffprobeData = await AudioFileScanner.probeAudioFile(audioFile.metadata.path)
    res.json(ffprobeData)
  }

  /**
   * GET api/items/:id/file/:fileid
   */
  async getLibraryFile(req: LibraryItemControllerRequestWithFile, res: Response) {
    const libraryFile = req.libraryFile

    if (global.XAccel) {
      const encodedURI = encodeUriPath(global.XAccel + libraryFile.metadata.path)
      Logger.debug(`Use X-Accel to serve static file ${encodedURI}`)
      return res.status(204).header({ 'X-Accel-Redirect': encodedURI }).send()
    }

    // Express does not set the correct mimetype for m4b files so use our defined mimetypes if available
    // Non-null: the library file is built from the item's stored libraryFiles JSON, whose metadata always has a path
    const audioMimeType = getAudioMimeTypeFromExtname(Path.extname(libraryFile.metadata.path!))
    if (audioMimeType) {
      res.setHeader('Content-Type', audioMimeType)
    }
    // Non-null: the library file is built from the item's stored libraryFiles JSON, whose metadata always has a path
    res.sendFile(libraryFile.metadata.path!)
  }

  /**
   * DELETE api/items/:id/file/:fileid
   */
  async deleteLibraryFile(req: LibraryItemControllerRequestWithFile, res: Response) {
    const libraryFile = req.libraryFile

    Logger.info(`[LibraryItemController] User "${req.user.username}" requested file delete at "${libraryFile.metadata.path}"`)

    // Non-null: the library file is built from the item's stored libraryFiles JSON, whose metadata always has a path
    await fs.remove(libraryFile.metadata.path!).catch((error) => {
      Logger.error(`[LibraryItemController] Failed to delete library file at "${libraryFile.metadata.path}"`, error)
    })

    req.libraryItem.libraryFiles = req.libraryItem.libraryFiles.filter((lf) => lf.ino !== req.params.fileid)
    req.libraryItem.changed('libraryFiles', true)

    if (req.libraryItem.isBook) {
      // cast(d): isBook is a getter and does not narrow media (Book | Podcast); this branch only runs for book items
      const book = req.libraryItem.media as Book
      if (book.audioFiles.some((af) => af.ino === req.params.fileid)) {
        book.audioFiles = book.audioFiles.filter((af) => af.ino !== req.params.fileid)
        book.changed('audioFiles', true)
      } else if (book.ebookFile?.ino === req.params.fileid) {
        book.ebookFile = null
        book.changed('ebookFile', true)
      }
      if (!book.hasMediaFiles) {
        req.libraryItem.isMissing = true
      }
      // cast(d): isBook is a getter and does not narrow media (Book | Podcast); an item that is not a book is a podcast (cast at the use site, the read is part of the else if condition)
    } else if ((req.libraryItem.media as Podcast).podcastEpisodes.some((ep) => ep.audioFile.ino === req.params.fileid)) {
      // cast(d): isBook is a getter and does not narrow media (Book | Podcast); an item that is not a book is a podcast
      const podcast = req.libraryItem.media as Podcast
      // Non-null: the else if condition found an episode with this audio file ino
      const episodeToRemove = podcast.podcastEpisodes.find((ep) => ep.audioFile.ino === req.params.fileid)!
      // Remove episode from all playlists
      await Database.playlistModel.removeMediaItemsFromPlaylists([episodeToRemove.id])

      // Remove episode media progress
      const numProgressRemoved = await Database.mediaProgressModel.destroy({
        where: {
          mediaItemId: episodeToRemove.id
        }
      })
      if (numProgressRemoved > 0) {
        Logger.info(`[LibraryItemController] Removed media progress for episode ${episodeToRemove.id}`)
      }

      // Remove episode
      await episodeToRemove.destroy()

      podcast.podcastEpisodes = podcast.podcastEpisodes.filter((ep) => ep.audioFile.ino !== req.params.fileid)
    }

    if (req.libraryItem.media.changed()) {
      // cast(b): TypeScript cannot call save() on the union of the two models (Book | Podcast); both are Sequelize models
      await (req.libraryItem.media as Book | Podcast).save()
    }

    await req.libraryItem.save()

    SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
    res.sendStatus(200)
  }

  /**
   * GET api/items/:id/file/:fileid/download
   * Same as GET api/items/:id/file/:fileid but allows logging and restricting downloads
   */
  async downloadLibraryFile(req: LibraryItemControllerRequestWithFile, res: Response) {
    const libraryFile = req.libraryFile
    const ua = uaParserJs(req.headers['user-agent'])

    if (!req.user.canDownload) {
      Logger.error(`[LibraryItemController] User "${req.user.username}" without download permission attempted to download file "${libraryFile.metadata.path}"`)
      return res.sendStatus(403)
    }

    Logger.info(`[LibraryItemController] User "${req.user.username}" requested download for item "${req.libraryItem.media.title}" file at "${libraryFile.metadata.path}"`)

    if (global.XAccel) {
      const encodedURI = encodeUriPath(global.XAccel + libraryFile.metadata.path)
      Logger.debug(`Use X-Accel to serve static file ${encodedURI}`)
      return res.status(204).header({ 'X-Accel-Redirect': encodedURI }).send()
    }

    // Express does not set the correct mimetype for m4b files so use our defined mimetypes if available
    // Non-null: the library file is built from the item's stored libraryFiles JSON, whose metadata always has a path
    let audioMimeType = getAudioMimeTypeFromExtname(Path.extname(libraryFile.metadata.path!))
    if (audioMimeType) {
      // Work-around for Apple devices mishandling Content-Type on mobile browsers:
      // https://github.com/advplyr/audiobookshelf/issues/3310
      // We actually need to check for Webkit on Apple mobile devices because this issue impacts all browsers on iOS/iPadOS/etc, not just Safari.
      const isAppleMobileBrowser = ua.device.vendor === 'Apple' && ua.device.type === 'mobile' && ua.engine.name === 'WebKit'
      if (isAppleMobileBrowser && audioMimeType === AudioMimeType.M4B) {
        audioMimeType = 'audio/m4b'
      }
      res.setHeader('Content-Type', audioMimeType)
    }

    try {
      // Non-null (2): the library file is built from the item's stored libraryFiles JSON, whose metadata always has a path and a filename
      await new Promise<void>((resolve, reject) => res.download(libraryFile.metadata.path!, libraryFile.metadata.filename!, (error) => (error ? reject(error) : resolve())))
      Logger.info(`[LibraryItemController] Downloaded file "${libraryFile.metadata.path}"`)
    } catch (error) {
      Logger.error(`[LibraryItemController] Failed to download file "${libraryFile.metadata.path}"`, error)
      LibraryItemController.handleDownloadError(error, res)
    }
  }

  /**
   * GET api/items/:id/ebook/:fileid?
   * fileid is the inode value stored in LibraryFile.ino or EBookFile.ino
   * fileid is only required when reading a supplementary ebook
   * when no fileid is passed in the primary ebook will be returned
   */
  async getEBookFile(req: LibraryItemControllerRequest, res: Response) {
    let ebookFile: LibraryFile | EBookFileObject | null | undefined = null
    if (req.params.fileid) {
      ebookFile = req.libraryItem.getLibraryFileWithIno(req.params.fileid)
      if (!ebookFile?.isEBookFile) {
        Logger.error(`[LibraryItemController] Invalid ebook file id "${req.params.fileid}"`)
        return res.status(400).send('Invalid ebook file id')
      }
    } else {
      // cast(d): this handler has no isBook check, so media may be a Podcast, which has no ebookFile: a podcast item reads undefined here and gets 404 from the !ebookFile check below, as in the JavaScript
      ebookFile = (req.libraryItem.media as Book).ebookFile
    }

    if (!ebookFile) {
      Logger.error(`[LibraryItemController] No ebookFile for library item "${req.libraryItem.media.title}"`)
      return res.sendStatus(404)
    }
    // Non-null: a library file or the stored ebookFile JSON always has a metadata path
    const ebookFilePath = ebookFile.metadata.path!

    Logger.info(`[LibraryItemController] User "${req.user.username}" requested download for item "${req.libraryItem.media.title}" ebook at "${ebookFilePath}"`)

    if (global.XAccel) {
      const encodedURI = encodeUriPath(global.XAccel + ebookFilePath)
      Logger.debug(`Use X-Accel to serve static file ${encodedURI}`)
      return res.status(204).header({ 'X-Accel-Redirect': encodedURI }).send()
    }

    try {
      await new Promise<void>((resolve, reject) => res.sendFile(ebookFilePath, (error) => (error ? reject(error) : resolve())))
      Logger.info(`[LibraryItemController] Downloaded ebook file "${ebookFilePath}"`)
    } catch (error) {
      Logger.error(`[LibraryItemController] Failed to download ebook file "${ebookFilePath}"`, error)
      LibraryItemController.handleDownloadError(error, res)
    }
  }

  /**
   * PATCH api/items/:id/ebook/:fileid/status
   * toggle the status of an ebook file.
   * if an ebook file is the primary ebook, then it will be changed to supplementary
   * if an ebook file is supplementary, then it will be changed to primary
   */
  async updateEbookFileStatus(req: LibraryItemControllerRequestWithFile, res: Response) {
    if (!req.libraryItem.isBook) {
      Logger.error(`[LibraryItemController] Invalid media type for ebook file status update`)
      return res.sendStatus(400)
    }
    // cast(d): isBook is a getter and does not narrow media (Book | Podcast); a non-book item returned 400 above
    const book = req.libraryItem.media as Book
    if (!req.libraryFile?.isEBookFile) {
      Logger.error(`[LibraryItemController] Invalid ebook file id "${req.params.fileid}"`)
      return res.status(400).send('Invalid ebook file id')
    }

    const ebookLibraryFile = req.libraryFile
    let primaryEbookFile: PrimaryEbookFileJson | null = null

    const ebookLibraryFileInos = req.libraryItem
      .getLibraryFiles()
      .filter((lf) => lf.isEBookFile)
      .map((lf) => lf.ino)

    if (ebookLibraryFile.isSupplementary) {
      Logger.info(`[LibraryItemController] Updating ebook file "${ebookLibraryFile.metadata.filename}" to primary`)

      primaryEbookFile = ebookLibraryFile.toJSON()
      delete primaryEbookFile.isSupplementary
      delete primaryEbookFile.fileType
      primaryEbookFile.ebookFormat = ebookLibraryFile.metadata.format
    } else {
      Logger.info(`[LibraryItemController] Updating ebook file "${ebookLibraryFile.metadata.filename}" to supplementary`)
    }

    // cast(d): the LibraryFile JSON with isSupplementary and fileType deleted and ebookFormat added is the stored ebookFile shape (ino and times are set for a file of the item)
    book.ebookFile = primaryEbookFile as EBookFileObject | null
    book.changed('ebookFile', true)
    await book.save()

    req.libraryItem.libraryFiles = req.libraryItem.libraryFiles.map((lf) => {
      if (ebookLibraryFileInos.includes(lf.ino)) {
        lf.isSupplementary = lf.ino !== primaryEbookFile?.ino
      }
      return lf
    })
    req.libraryItem.changed('libraryFiles', true)

    req.libraryItem.isMissing = !book.hasMediaFiles

    await req.libraryItem.save()

    SocketAuthority.libraryItemEmitter('item_updated', req.libraryItem)
    res.sendStatus(200)
  }

  /**
   */
  async middleware(req: RequestWithUser & { libraryItem?: LibraryItem.LibraryItemExpanded | null; libraryFile?: LibraryFile | null }, res: Response, next: NextFunction) {
    req.libraryItem = await Database.libraryItemModel.getExpandedById(req.params.id)
    if (!req.libraryItem?.media) return res.sendStatus(404)

    // Check user can access this library item
    if (!req.user.checkCanAccessLibraryItem(req.libraryItem)) {
      return res.sendStatus(403)
    }

    // For library file routes, get the library file
    if (req.params.fileid) {
      req.libraryFile = req.libraryItem.getLibraryFileWithIno(req.params.fileid)
      if (!req.libraryFile) {
        Logger.error(`[LibraryItemController] Library file "${req.params.fileid}" does not exist for library item`)
        return res.sendStatus(404)
      }
    }

    if (req.path.includes('/play')) {
      // allow POST requests using /play and /play/:episodeId
    } else if (req.method == 'DELETE' && !req.user.canDelete) {
      Logger.warn(`[LibraryItemController] User "${req.user.username}" attempted to delete without permission`)
      return res.sendStatus(403)
    } else if ((req.method == 'PATCH' || req.method == 'POST') && !req.user.canUpdate) {
      Logger.warn(`[LibraryItemController] User "${req.user.username}" attempted to update without permission`)
      return res.sendStatus(403)
    }

    next()
  }
}
export = new LibraryItemController()
