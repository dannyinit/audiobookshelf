import Logger = require('../Logger')
import iTunes = require('../providers/iTunes')

type iTunesPodcastSearchResult = import('../providers/iTunes').iTunesPodcastSearchResult

interface PodcastSearchOptions {
  country?: string
}

class PodcastFinder {
  iTunesApi: iTunes

  constructor() {
    this.iTunesApi = new iTunes()
  }

  /**
   *
   * @param {string} term
   * @param {{country:string}} options
   * @returns {Promise<import('../providers/iTunes').iTunesPodcastSearchResult[]>}
   */
  async search(term: string, options: PodcastSearchOptions = {}): Promise<iTunesPodcastSearchResult[] | null> {
    if (!term) return null
    Logger.debug(`[iTunes] Searching for podcast with term "${term}"`)
    // iTunes.searchPodcasts JSDoc marks country as required, but it only spreads options into the query
    const results = await this.iTunesApi.searchPodcasts(term, options as { country: string })
    Logger.debug(`[iTunes] Podcast search for "${term}" returned ${results.length} results`)
    return results
  }

  /**
   * @param {string} term
   * @returns {Promise<string[]>}
   */
  async findCovers(term: string): Promise<string[] | null> {
    if (!term) return null
    Logger.debug(`[iTunes] Searching for podcast covers with term "${term}"`)
    const results = await this.iTunesApi.searchPodcasts(term)
    if (!results) return []
    return results.map((r) => r.cover).filter((r) => r)
  }
}
export = new PodcastFinder()
