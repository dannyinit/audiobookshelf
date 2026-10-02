import AudioMetaTags = require('../objects/metadata/AudioMetaTags')

type ParsedProbeData = import('../utils/prober').ParsedProbeData
type MediaStreamInfo = import('../utils/prober').MediaStreamInfo

class MediaProbeData {
  embeddedCoverArt: string | null
  format: string | null
  duration: number | null
  size: number | null

  audioStream: MediaStreamInfo | null
  videoStream: MediaStreamInfo | null

  bitRate: number | null
  codec: string | null
  timeBase: string | null
  language: string | null
  channelLayout: string | null
  channels: number | null
  sampleRate: number | null
  chapters: import('../utils/prober').ProbeChapter[]

  audioMetaTags: AudioMetaTags | null

  trackNumber: number | null
  trackTotal: number | null

  discNumber: number | null
  discTotal: number | null

  constructor(probeData?: Record<string, any>) {
    this.embeddedCoverArt = null
    this.format = null
    this.duration = null
    this.size = null

    this.audioStream = null
    this.videoStream = null

    this.bitRate = null
    this.codec = null
    this.timeBase = null
    this.language = null
    this.channelLayout = null
    this.channels = null
    this.sampleRate = null
    this.chapters = []

    this.audioMetaTags = null

    this.trackNumber = null
    this.trackTotal = null

    this.discNumber = null
    this.discTotal = null

    if (probeData) {
      this.construct(probeData)
    }
  }

  construct(probeData: Record<string, any>) {
    const self = this as Record<string, any>
    for (const key in probeData) {
      if (key === 'audioMetaTags' && probeData[key]) {
        this.audioMetaTags = new AudioMetaTags(probeData[key])
      } else if (self[key] !== undefined) {
        self[key] = probeData[key]
      }
    }
  }

  setData(data: ParsedProbeData) {
    this.embeddedCoverArt = data.video_stream?.codec || null
    this.format = data.format
    this.duration = data.duration
    this.size = data.size

    this.audioStream = data.audio_stream ?? null
    this.videoStream = this.embeddedCoverArt ? null : data.video_stream || null

    // audio_stream is only missing for video-only files, where the original code also threw here
    const audioStream = this.audioStream!
    this.bitRate = audioStream.bit_rate || data.bit_rate
    this.codec = audioStream.codec
    this.timeBase = audioStream.time_base
    this.language = audioStream.language
    this.channelLayout = audioStream.channel_layout ?? null
    this.channels = audioStream.channels ?? null
    this.sampleRate = audioStream.sample_rate ?? null
    this.chapters = data.chapters || []

    this.audioMetaTags = new AudioMetaTags()
    this.audioMetaTags.setData(data.tags)
  }
}
export = MediaProbeData
