import type FileMetadata = require('../metadata/FileMetadata')
import type AudioFile = require('./AudioFile')

class AudioTrack {
  declare index: number | null
  declare startOffset: number | null
  declare duration: number | null
  declare title: string | null
  declare contentUrl: string | null
  declare mimeType: string | null
  declare codec: string | null
  declare metadata: FileMetadata | null

  constructor() {
    this.index = null
    this.startOffset = null
    this.duration = null
    this.title = null
    this.contentUrl = null
    this.mimeType = null
    this.codec = null
    this.metadata = null
  }

  toJSON() {
    return {
      index: this.index,
      startOffset: this.startOffset,
      duration: this.duration,
      title: this.title,
      contentUrl: this.contentUrl,
      mimeType: this.mimeType,
      codec: this.codec,
      metadata: this.metadata?.toJSON() || null
    }
  }

  setData(itemId: string, audioFile: AudioFile, startOffset: number) {
    this.index = audioFile.index
    this.startOffset = startOffset
    this.duration = audioFile.duration
    this.title = audioFile.metadata.filename || ''

    this.contentUrl = `/api/items/${itemId}/file/${audioFile.ino}`
    this.mimeType = audioFile.mimeType
    this.codec = audioFile.codec || null
    this.metadata = audioFile.metadata.clone()
  }

  setFromStream(title: string, duration: number, contentUrl: string) {
    this.index = 1
    this.startOffset = 0
    this.duration = duration
    this.title = title
    this.contentUrl = contentUrl
    this.mimeType = 'application/vnd.apple.mpegurl'
  }
}
export = AudioTrack
