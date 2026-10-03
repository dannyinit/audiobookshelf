import Logger = require('../Logger')
import iTunes = require('../providers/iTunes')

class PodcastFinder {
  iTunesApi: iTunes

  constructor() {
    this.iTunesApi = new iTunes()
  }

  async search(term: string, options: { country?: string } = {}): Promise<iTunes.iTunesPodcastSearchResult[] | null> {
    if (!term) return null
    Logger.debug(`[iTunes] Searching for podcast with term "${term}"`)
    const results = await this.iTunesApi.searchPodcasts(term, options)
    Logger.debug(`[iTunes] Podcast search for "${term}" returned ${results.length} results`)
    return results
  }

  async findCovers(term: string): Promise<string[] | null> {
    if (!term) return null
    Logger.debug(`[iTunes] Searching for podcast covers with term "${term}"`)
    const results = await this.iTunesApi.searchPodcasts(term)
    if (!results) return []
    return results.map((r) => r.cover).filter((r): r is string => !!r)
  }
}
export = new PodcastFinder()
