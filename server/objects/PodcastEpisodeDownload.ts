import Path = require('path')
import uuid = require('uuid')
import fileUtils = require('../utils/fileUtils')
import globals = require('../utils/globals')
import type LibraryItem = require('../models/LibraryItem')
const uuidv4 = uuid.v4
const { sanitizeFilename, filePathToPOSIX } = fileUtils

/**
 * Episode parsed from an RSS feed (the RssPodcastEpisode type in utils/podcastUtils)
 */
type RssPodcastEpisode = NonNullable<ReturnType<typeof import('../utils/podcastUtils').findMatchingEpisodesInFeed>>[number]['episode']

class PodcastEpisodeDownload {
  declare id: string | null
  declare rssPodcastEpisode: RssPodcastEpisode

  declare url: string
  declare libraryItem: LibraryItem
  declare libraryId: string | null

  declare isAutoDownload: boolean
  declare isFinished: boolean
  declare failed: boolean

  declare appendRandomId: boolean

  /** false when sanitizeFilename gets a non-string (never the case here) */
  declare targetFilename: string | false | null

  declare startedAt: number | null
  declare createdAt: number | null
  declare finishedAt: number | null

  constructor() {
    this.id = null
    // Typed RssPodcastEpisode (as the JSDoc did); setData sets it before use
    this.rssPodcastEpisode = null as unknown as RssPodcastEpisode

    // Typed string; setData sets it before use
    this.url = null as unknown as string
    // Typed LibraryItem (as the JSDoc did); setData sets it before use
    this.libraryItem = null as unknown as LibraryItem
    this.libraryId = null

    this.isAutoDownload = false
    this.isFinished = false
    this.failed = false

    this.appendRandomId = false

    this.targetFilename = null

    this.startedAt = null
    this.createdAt = null
    this.finishedAt = null
  }

  toJSONForClient() {
    return {
      id: this.id,
      episodeDisplayTitle: this.rssPodcastEpisode?.title ?? null,
      url: this.url,
      libraryItemId: this.libraryItemId,
      libraryId: this.libraryId || null,
      isFinished: this.isFinished,
      failed: this.failed,
      appendRandomId: this.appendRandomId,
      startedAt: this.startedAt,
      createdAt: this.createdAt,
      finishedAt: this.finishedAt,
      podcastTitle: this.libraryItem?.media.title ?? null,
      podcastExplicit: !!this.libraryItem?.media.explicit,
      season: this.rssPodcastEpisode?.season ?? null,
      episode: this.rssPodcastEpisode?.episode ?? null,
      episodeType: this.rssPodcastEpisode?.episodeType ?? 'full',
      publishedAt: this.rssPodcastEpisode?.publishedAt ?? null,
      guid: this.rssPodcastEpisode?.guid ?? null
    }
  }

  get urlFileExtension() {
    const cleanUrl = this.url.split('?')[0] // Remove query string
    return Path.extname(cleanUrl).substring(1).toLowerCase()
  }
  get fileExtension() {
    const extname = this.urlFileExtension
    if (globals.SupportedAudioTypes.includes(extname)) return extname
    return 'mp3'
  }
  get enclosureType() {
    const enclosureType = this.rssPodcastEpisode.enclosure.type
    return typeof enclosureType === 'string' ? enclosureType : null
  }
  get episodeTitle() {
    return this.rssPodcastEpisode.title
  }
  get targetPath() {
    // setData sets targetFilename to a string before the getters are used
    return filePathToPOSIX(Path.join(this.libraryItem.path, this.targetFilename as string))
  }
  get targetRelPath() {
    return this.targetFilename
  }
  get libraryItemId() {
    return this.libraryItem?.id || null
  }
  get pubYear() {
    if (!this.rssPodcastEpisode.publishedAt) return null
    return new Date(this.rssPodcastEpisode.publishedAt).getFullYear()
  }

  /**
   * @param title
   */
  getSanitizedFilename(title: string) {
    const appendage = this.appendRandomId ? ` (${this.id})` : ''
    const filename = `${title.trim()}${appendage}.${this.fileExtension}`
    return sanitizeFilename(filename)
  }

  /**
   * @param appendRandomId
   */
  setAppendRandomId(appendRandomId: boolean) {
    this.appendRandomId = appendRandomId
    this.targetFilename = this.getSanitizedFilename(this.rssPodcastEpisode.title || '')
  }

  /**
   *
   * @param rssPodcastEpisode - from rss feed
   * @param libraryItem
   * @param isAutoDownload
   * @param libraryId
   */
  setData(rssPodcastEpisode: RssPodcastEpisode, libraryItem: LibraryItem, isAutoDownload: boolean, libraryId: string) {
    this.id = uuidv4()
    this.rssPodcastEpisode = rssPodcastEpisode

    const url = rssPodcastEpisode.enclosure.url
    if (decodeURIComponent(url) !== url) {
      // Already encoded
      this.url = url
    } else {
      this.url = encodeURI(url)
    }

    this.targetFilename = this.getSanitizedFilename(this.rssPodcastEpisode.title || '')

    this.libraryItem = libraryItem
    this.isAutoDownload = isAutoDownload
    this.createdAt = Date.now()
    this.libraryId = libraryId
  }

  setFinished(success: boolean) {
    this.finishedAt = Date.now()
    this.isFinished = true
    this.failed = !success
  }
}
export = PodcastEpisodeDownload
