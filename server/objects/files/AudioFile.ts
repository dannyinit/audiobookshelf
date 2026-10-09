import constants = require('../../utils/constants')
import AudioMetaTags = require('../metadata/AudioMetaTags')
import FileMetadata = require('../metadata/FileMetadata')
import type MediaProbeData = require('../../scanner/MediaProbeData')
import type { AudioChapter, FileMetadataJSON } from '../types'
const { AudioMimeType } = constants

/**
 * AudioFile as stored in JSON (see toJSON); the input of the constructor (older JSON may lack fields, which are then copied as undefined)
 */
interface AudioFileData {
  index: number | null
  ino: string | null
  metadata?: Partial<FileMetadataJSON> | null
  addedAt: number | null
  updatedAt: number | null
  trackNumFromMeta: number | null
  discNumFromMeta: number | null
  trackNumFromFilename: number | null
  /** Old name of discNumFromFilename */
  cdNumFromFilename?: number | null
  discNumFromFilename: number | null
  manuallyVerified?: boolean
  exclude?: boolean
  error?: string | null
  format: string | null
  duration: number | null
  bitRate: number | null
  language: string | null
  codec?: string | null
  timeBase: string | null
  channels: number | null
  channelLayout: string | null
  chapters: AudioChapter[]
  embeddedCoverArt?: string | null
  metaTags?: ConstructorParameters<typeof AudioMetaTags>[0]
}

class AudioFile {
  declare index: number | null
  declare ino: string | null
  declare metadata: FileMetadata
  declare addedAt: number | null
  declare updatedAt: number | null

  declare trackNumFromMeta: number | null
  declare discNumFromMeta: number | null
  declare trackNumFromFilename: number | null
  declare discNumFromFilename: number | null

  declare format: string | null
  declare duration: number | null
  declare bitRate: number | null
  declare language: string | null
  declare codec: string | null
  declare timeBase: string | null
  declare channels: number | null
  declare channelLayout: string | null
  declare chapters: AudioChapter[]
  declare embeddedCoverArt: string | null

  // Tags scraped from the audio file
  declare metaTags: AudioMetaTags | null

  declare manuallyVerified: boolean
  declare exclude: boolean
  declare error: string | null

  constructor(data?: AudioFileData | null) {
    this.index = null
    this.ino = null
    // Typed FileMetadata (as the JSDoc did); construct or setDataFromProbe sets it before use
    this.metadata = null as unknown as FileMetadata
    this.addedAt = null
    this.updatedAt = null

    this.trackNumFromMeta = null
    this.discNumFromMeta = null
    this.trackNumFromFilename = null
    this.discNumFromFilename = null

    this.format = null
    this.duration = null
    this.bitRate = null
    this.language = null
    this.codec = null
    this.timeBase = null
    this.channels = null
    this.channelLayout = null
    this.chapters = []
    this.embeddedCoverArt = null

    // Tags scraped from the audio file
    this.metaTags = null

    this.manuallyVerified = false
    this.exclude = false
    this.error = null

    if (data) {
      this.construct(data)
    }
  }

  toJSON() {
    return {
      index: this.index,
      ino: this.ino,
      metadata: this.metadata.toJSON(),
      addedAt: this.addedAt,
      updatedAt: this.updatedAt,
      trackNumFromMeta: this.trackNumFromMeta,
      discNumFromMeta: this.discNumFromMeta,
      trackNumFromFilename: this.trackNumFromFilename,
      discNumFromFilename: this.discNumFromFilename,
      manuallyVerified: !!this.manuallyVerified,
      exclude: !!this.exclude,
      error: this.error || null,
      format: this.format,
      duration: this.duration,
      bitRate: this.bitRate,
      language: this.language,
      codec: this.codec,
      timeBase: this.timeBase,
      channels: this.channels,
      channelLayout: this.channelLayout,
      chapters: this.chapters,
      embeddedCoverArt: this.embeddedCoverArt,
      metaTags: this.metaTags?.toJSON() || {},
      mimeType: this.mimeType
    }
  }

  construct(data: AudioFileData) {
    this.index = data.index
    this.ino = data.ino
    this.metadata = new FileMetadata(data.metadata || {})
    this.addedAt = data.addedAt
    this.updatedAt = data.updatedAt
    this.manuallyVerified = !!data.manuallyVerified
    this.exclude = !!data.exclude
    this.error = data.error || null

    this.trackNumFromMeta = data.trackNumFromMeta
    this.discNumFromMeta = data.discNumFromMeta
    this.trackNumFromFilename = data.trackNumFromFilename

    if (data.cdNumFromFilename !== undefined) this.discNumFromFilename = data.cdNumFromFilename // TEMP:Support old var name
    else this.discNumFromFilename = data.discNumFromFilename

    this.format = data.format
    this.duration = data.duration
    this.bitRate = data.bitRate
    this.language = data.language
    this.codec = data.codec || null
    this.timeBase = data.timeBase
    this.channels = data.channels
    this.channelLayout = data.channelLayout
    this.chapters = data.chapters
    this.embeddedCoverArt = data.embeddedCoverArt || null

    this.metaTags = new AudioMetaTags(data.metaTags || {})
  }

  get mimeType() {
    // Index the mime type map by any format string; unknown formats read undefined, like the JS
    const mimeTypes = AudioMimeType as Record<string, string | undefined>
    const format = this.metadata.format.toUpperCase()
    if (mimeTypes[format]) {
      return mimeTypes[format]
    } else {
      return AudioMimeType.MP3
    }
  }

  // New scanner creates AudioFile from AudioFileScanner
  setDataFromProbe(libraryFile: { ino?: string | null; metadata: FileMetadata | Partial<FileMetadataJSON> }, probeData: MediaProbeData) {
    this.ino = libraryFile.ino || null

    if (libraryFile.metadata instanceof FileMetadata) {
      this.metadata = libraryFile.metadata.clone()
    } else {
      this.metadata = new FileMetadata(libraryFile.metadata)
    }

    this.addedAt = Date.now()
    this.updatedAt = Date.now()

    this.format = probeData.format
    this.duration = probeData.duration
    this.bitRate = probeData.bitRate || null
    this.language = probeData.language
    this.codec = probeData.codec || null
    this.timeBase = probeData.timeBase
    this.channels = probeData.channels
    this.channelLayout = probeData.channelLayout
    this.chapters = probeData.chapters || []
    // Probe data from prober.probe always has audioMetaTags (MediaProbeData.setData)
    this.metaTags = probeData.audioMetaTags as AudioMetaTags
    this.embeddedCoverArt = probeData.embeddedCoverArt
  }

  syncChapters(updatedChapters: AudioChapter[]) {
    if (this.chapters.length !== updatedChapters.length) {
      this.chapters = updatedChapters.map(ch => ({ ...ch }))
      return true
    } else if (updatedChapters.length === 0) {
      if (this.chapters.length > 0) {
        this.chapters = []
        return true
      }
      return false
    }

    let hasUpdates = false
    for (let i = 0; i < updatedChapters.length; i++) {
      if (JSON.stringify(updatedChapters[i]) !== JSON.stringify(this.chapters[i])) {
        hasUpdates = true
      }
    }
    if (hasUpdates) {
      this.chapters = updatedChapters.map(ch => ({ ...ch }))
    }
    return hasUpdates
  }

  clone() {
    return new AudioFile(this.toJSON())
  }

  /**
   *
   * @param scannedAudioFile
   * @returns true if updates were made
   */
  updateFromScan(scannedAudioFile: AudioFile) {
    let hasUpdated = false

    const newjson = scannedAudioFile.toJSON()
    const ignoreKeys = ['manuallyVerified', 'ctimeMs', 'addedAt', 'updatedAt']

    // Index this object and the new JSON by key
    const self = this as unknown as Record<string, unknown>
    const newValues = newjson as Record<string, unknown>
    for (const key in newjson) {
      if (key === 'metadata') {
        if (this.metadata.update(newjson[key])) {
          hasUpdated = true
        }
      } else if (key === 'metaTags') {
        if (!this.metaTags || !this.metaTags.isEqual(scannedAudioFile.metaTags)) {
          // cast(d): a scanned audio file has meta tags (setDataFromProbe sets them)
          this.metaTags = scannedAudioFile.metaTags!.clone()
          hasUpdated = true
        }
      } else if (key === 'chapters') {
        if (this.syncChapters(newjson.chapters || [])) {
          hasUpdated = true
        }
      } else if (!ignoreKeys.includes(key) && self[key] !== newValues[key]) {
        self[key] = newValues[key]
        hasUpdated = true
      }
    }
    return hasUpdated
  }
}
export = AudioFile
