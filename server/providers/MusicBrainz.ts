import axios, { AxiosRequestConfig } from 'axios'
import packageJson = require('../../package.json')
import Logger = require('../Logger')
import utils = require('../utils/index')

const { isNullOrNaN } = utils

interface MusicBrainzTrackSearchOptions {
  artist?: string
  isrc?: string
  title?: string
  album?: string
  limit?: number | string | null
}

/**
 * Recording as returned by the MusicBrainz recording search endpoint (only the common fields)
 * @see https://musicbrainz.org/doc/MusicBrainz_API/Search#Recording
 */
interface MusicBrainzRecording {
  id: string
  score: number
  title: string
  length?: number
}

interface MusicBrainzRecordingSearchResponse {
  recordings?: MusicBrainzRecording[]
}

class MusicBrainz {
  constructor() { }

  get userAgentString() {
    return `audiobookshelf/${packageJson.version} (https://audiobookshelf.org)`
  }

  // https://musicbrainz.org/doc/MusicBrainz_API/Search
  searchTrack(options: MusicBrainzTrackSearchOptions): Promise<MusicBrainzRecording[]> | never[] {
    let luceneParts: string[] = []
    if (options.artist) {
      luceneParts.push(`artist:${options.artist}`)
    }
    if (options.isrc) {
      luceneParts.push(`isrc:${options.isrc}`)
    }
    if (options.title) {
      luceneParts.push(`recording:${options.title}`)
    }
    if (options.album) {
      luceneParts.push(`release:${options.album}`)
    }
    if (!luceneParts.length) {
      Logger.error(`[MusicBrainz] Invalid search options - must have at least one of artist, isrc, title, album`)
      return []
    }

    const query = {
      query: luceneParts.join(' AND '),
      limit: isNullOrNaN(options.limit) ? 15 : Number(options.limit),
      fmt: 'json'
    }
    // NOTE: this config was passed as a 3rd argument to axios.get, which only accepts (url, config),
    // so the User-Agent header is never sent (existing behaviour)
    const config: AxiosRequestConfig = {
      headers: {
        'User-Agent': this.userAgentString
      }
    }
    return axios.get<MusicBrainzRecordingSearchResponse>('https://musicbrainz.org/ws/2/recording', { params: query }).then((response) => {
      return response.data.recordings || []
    }).catch((error: unknown) => {
      Logger.error(`[MusicBrainz] search request error`, error)
      return []
    })
  }
}
export = MusicBrainz
