import axios, { AxiosError } from 'axios'
import Logger = require('../Logger')

/**
 * Cover as returned by the audiobookcovers.com bytext endpoint (only the fields used)
 */
interface AudiobookCoversItem {
  versions: {
    png: {
      original: string
    }
  }
}

class AudiobookCovers {
  #responseTimeout = 10000

  constructor() {}

  async search(search: string, timeout: number = this.#responseTimeout): Promise<{ cover: string }[]> {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const url = `https://api.audiobookcovers.com/cover/bytext/`
    const params = new URLSearchParams([['q', search]])
    const items = await axios
      .get<AudiobookCoversItem[]>(url, {
        params,
        timeout
      })
      .then((res) => res?.data || [])
      .catch((error: AxiosError) => {
        Logger.error('[AudiobookCovers] Cover search error', error.message)
        return []
      })
    return items.map((item) => ({ cover: item.versions.png.original }))
  }
}
export = AudiobookCovers
