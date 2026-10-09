import AudioMetaTags = require('../objects/metadata/AudioMetaTags')
import type { ProbeStreamInfo, RawProbeData } from '../utils/types'
import type { AudioChapter } from '../objects/types'

class MediaProbeData {
  declare embeddedCoverArt: string | null
  declare format: string | null
  declare duration: number | null
  declare size: number | null

  declare audioStream: ProbeStreamInfo | null
  declare videoStream: ProbeStreamInfo | null

  declare bitRate: number | null
  declare codec: string | null
  declare timeBase: string | null
  declare language: string | null
  declare channelLayout: string | null
  declare channels: number | null
  declare sampleRate: number | null | undefined
  declare chapters: AudioChapter[]

  declare audioMetaTags: AudioMetaTags | null

  declare trackNumber: number | null
  declare trackTotal: number | null

  declare discNumber: number | null
  declare discTotal: number | null

  /** Never set: prober.probe returns { error } instead of a MediaProbeData when probing fails */
  declare error?: undefined

  constructor(probeData?: Record<string, unknown> | null) {
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

  construct(probeData: Record<string, unknown>) {
    for (const key in probeData) {
      if (key === 'audioMetaTags' && probeData[key]) {
        // cast(d): this object indexed by the keys of the stored probe data; the stored audio meta tags are AudioMetaTags toJSON
        (this as unknown as Record<string, unknown>)[key] = new AudioMetaTags(probeData[key] as ConstructorParameters<typeof AudioMetaTags>[0])
        // cast(d): this object indexed by the keys of the stored probe data
      } else if ((this as unknown as Record<string, unknown>)[key] !== undefined) {
        // cast(d): this object indexed by the keys of the stored probe data
        (this as unknown as Record<string, unknown>)[key] = probeData[key]
      }
    }
  }

  setData(data: RawProbeData) {
    this.embeddedCoverArt = data.video_stream?.codec || null
    this.format = data.format
    this.duration = data.duration
    this.size = data.size

    // NOTE: prober only checks that there is an audio or a video stream; with a video stream only, audio_stream is null and the reads below throw a TypeError (prober.probe then returns it as the error)
    // cast(c): read as in the JS (see NOTE above)
    this.audioStream = data.audio_stream as ProbeStreamInfo
    this.videoStream = this.embeddedCoverArt ? null : data.video_stream || null

    this.bitRate = this.audioStream.bit_rate || data.bit_rate
    this.codec = this.audioStream.codec
    this.timeBase = this.audioStream.time_base
    this.language = this.audioStream.language
    // cast(d): set for audio streams; split always returns at least one element, so it is not undefined
    this.channelLayout = this.audioStream.channel_layout as string | null
    // cast(d): prober sets channels on every audio stream
    this.channels = this.audioStream.channels as number | null
    this.sampleRate = this.audioStream.sample_rate
    // cast(d): parseChapters sets the id of every chapter
    this.chapters = (data.chapters || []) as AudioChapter[]

    this.audioMetaTags = new AudioMetaTags()
    this.audioMetaTags.setData(data.tags)
  }
}
export = MediaProbeData
