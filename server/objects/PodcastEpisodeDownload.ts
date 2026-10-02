import Path = require('path')
import { v4 as uuidv4 } from 'uuid'
import { sanitizeFilename, filePathToPOSIX } from '../utils/fileUtils'
import globals = require('../utils/globals')

class PodcastEpisodeDownload {
  id: string | null
  /** from rss feed, set by setData() which always follows construction */
  rssPodcastEpisode!: import('../utils/podcastUtils').RssPodcastEpisode

  url: string | null
  /** set by setData() which always follows construction */
  libraryItem!: import('../models/LibraryItem')
  libraryId: string | null

  isAutoDownload: boolean
  isFinished: boolean
  failed: boolean

  appendRandomId: boolean

  targetFilename: string | null

  startedAt: number | null
  createdAt: number | null
  finishedAt: number | null

  constructor() {
    this.id = null

    this.url = null
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
    const cleanUrl = this.url!.split('?')[0] // Remove query string
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
    return filePathToPOSIX(Path.join(this.libraryItem.path, this.targetFilename!))
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
   * @param {string} title
   */
  getSanitizedFilename(title: string) {
    const appendage = this.appendRandomId ? ` (${this.id})` : ''
    const filename = `${title.trim()}${appendage}.${this.fileExtension}`
    return sanitizeFilename(filename)
  }

  /**
   * @param {boolean} appendRandomId
   */
  setAppendRandomId(appendRandomId: boolean) {
    this.appendRandomId = appendRandomId
    this.targetFilename = this.getSanitizedFilename(this.rssPodcastEpisode.title || '')
  }

  /**
   *
   * @param {import('../utils/podcastUtils').RssPodcastEpisode} rssPodcastEpisode - from rss feed
   * @param {import('../models/LibraryItem')} libraryItem
   * @param {*} isAutoDownload
   * @param {*} libraryId
   */
  setData(rssPodcastEpisode: import('../utils/podcastUtils').RssPodcastEpisode, libraryItem: import('../models/LibraryItem'), isAutoDownload: boolean, libraryId: string) {
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
