import axios, { AxiosError } from 'axios'
import Logger = require('../Logger')
import utils = require('../utils/index')
import type { SeriesResult } from './types'

const { isValidASIN } = utils

/**
 * Audible region codes mapped to their top level domains
 */
type RegionMap = Record<string, string>

interface AudnexusContributor {
  asin?: string
  name: string
}

interface AudnexusGenre {
  asin?: string
  name: string
  type: string
}

interface AudnexusSeries {
  asin?: string
  name: string
  position?: string
}

/**
 * Book as returned by the audnex.us books endpoint
 */
interface AudnexusBook {
  asin: string
  title: string
  subtitle?: string
  authors?: AudnexusContributor[]
  narrators?: AudnexusContributor[]
  publisherName?: string
  summary?: string
  releaseDate?: string
  image?: string
  genres?: AudnexusGenre[]
  seriesPrimary?: AudnexusSeries
  seriesSecondary?: AudnexusSeries
  language?: string
  runtimeLengthMin?: number | string
  formatType?: string
  isbn?: string
  region?: string
  rating?: string
  isAdult?: boolean
}

interface AudibleCatalogResponse {
  products?: { asin: string }[]
}

interface AudibleBookResult {
  title: string
  subtitle: string | null
  author: string | null
  narrator: string | null
  publisher: string | undefined
  publishedYear: string | null
  description: string | null
  cover: string | undefined
  asin: string
  isbn: string | undefined
  genres: string[] | null
  tags: string[] | null
  series: SeriesResult[] | null
  language: string | null
  duration: number
  region: string | null
  rating: string | null
  abridged: boolean
  explicit: boolean
}

class Audible {
  #responseTimeout = 10000

  regionMap: RegionMap

  constructor() {
    this.regionMap = {
      us: '.com',
      ca: '.ca',
      uk: '.co.uk',
      au: '.com.au',
      fr: '.fr',
      de: '.de',
      jp: '.co.jp',
      it: '.it',
      in: '.in',
      es: '.es'
    }
  }

  /**
   * Audible will sometimes send sequences with "Book 1" or "2, Dramatized Adaptation"
   * @see https://github.com/advplyr/audiobookshelf/issues/2380
   * @see https://github.com/advplyr/audiobookshelf/issues/1339
   */
  cleanSeriesSequence(seriesName: string, sequence: string): string {
    if (!sequence) return ''
    // match any number with optional decimal (e.g, 1 or 1.5 or .5)
    let numberFound = sequence.match(/\.\d+|\d+(?:\.\d+)?/)
    let updatedSequence = numberFound ? numberFound[0] : sequence
    if (sequence !== updatedSequence) {
      Logger.debug(`[Audible] Series "${seriesName}" sequence was cleaned from "${sequence}" to "${updatedSequence}"`)
    }
    return updatedSequence
  }

  cleanResult(item: AudnexusBook): AudibleBookResult {
    const { title, subtitle, asin, authors, narrators, publisherName, summary, releaseDate, image, genres, seriesPrimary, seriesSecondary, language, runtimeLengthMin, formatType, isbn } = item

    const series: SeriesResult[] = []
    if (seriesPrimary) {
      series.push({
        series: seriesPrimary.name,
        sequence: this.cleanSeriesSequence(seriesPrimary.name, seriesPrimary.position || '')
      })
    }
    if (seriesSecondary) {
      series.push({
        series: seriesSecondary.name,
        sequence: this.cleanSeriesSequence(seriesSecondary.name, seriesSecondary.position || '')
      })
    }

    let genresCleaned: string[] = []
    let tagsCleaned: string[] = []

    if (genres && Array.isArray(genres)) {
      genresCleaned = [...new Set(genres.filter((g) => g.type == 'genre').map((g) => g.name))]
      tagsCleaned = [...new Set(genres.filter((g) => g.type == 'tag').map((g) => g.name))]
    }

    return {
      title,
      subtitle: subtitle || null,
      author: authors ? authors.map(({ name }) => name).join(', ') : null,
      narrator: narrators ? narrators.map(({ name }) => name).join(', ') : null,
      publisher: publisherName,
      publishedYear: releaseDate ? releaseDate.split('-')[0] : null,
      description: summary || null,
      cover: image,
      asin,
      isbn,
      genres: genresCleaned.length ? genresCleaned : null,
      tags: tagsCleaned.length ? tagsCleaned : null,
      series: series.length ? series : null,
      language: language ? language.charAt(0).toUpperCase() + language.slice(1) : null,
      duration: runtimeLengthMin && !isNaN(Number(runtimeLengthMin)) ? Number(runtimeLengthMin) : 0,
      region: item.region || null,
      rating: item.rating || null,
      abridged: formatType === 'abridged',
      explicit: !!item.isAdult
    }
  }

  /**
   * @param timeout response timeout in ms
   */
  asinSearch(asin: string, region: string, timeout: number = this.#responseTimeout): Promise<AudnexusBook | null> | null {
    if (!asin) return null
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    asin = encodeURIComponent(asin.toUpperCase())
    var regionQuery = region ? `?region=${region}` : ''
    var url = `https://api.audnex.us/books/${asin}${regionQuery}`
    Logger.debug(`[Audible] ASIN url: ${url}`)
    return axios
      .get<AudnexusBook>(url, {
        timeout
      })
      .then((res) => {
        if (!res?.data?.asin) return null
        return res.data
      })
      .catch((error: AxiosError) => {
        Logger.error('[Audible] ASIN search error', error.message)
        return null
      })
  }

  /**
   * @param timeout response timeout in ms
   */
  async search(title: string, author: string | null | undefined, asin: string | null | undefined, region: string, timeout: number = this.#responseTimeout): Promise<AudibleBookResult[]> {
    if (region && !this.regionMap[region]) {
      Logger.error(`[Audible] search: Invalid region ${region}`)
      region = ''
    }
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    let items: (AudnexusBook | null)[] | null = []
    if (asin && isValidASIN(asin.toUpperCase())) {
      const item = await this.asinSearch(asin, region, timeout)
      if (item) items.push(item)
    }

    if (!items.length && isValidASIN(title.toUpperCase())) {
      const item = await this.asinSearch(title, region, timeout)
      if (item) items.push(item)
    }

    if (!items.length) {
      const queryObj: Record<string, string> = {
        num_results: '10',
        products_sort_by: 'Relevance',
        title: title
      }
      if (author) queryObj.author = author
      const queryString = new URLSearchParams(queryObj).toString()
      const tld = region ? this.regionMap[region] : '.com'
      const url = `https://api.audible${tld}/1.0/catalog/products?${queryString}`
      Logger.debug(`[Audible] Search url: ${url}`)
      items = await axios
        .get<AudibleCatalogResponse>(url, {
          timeout
        })
        .then((res) => {
          if (!res?.data?.products) return null
          return Promise.all(res.data.products.map((result) => this.asinSearch(result.asin, region, timeout)))
        })
        .catch((error: AxiosError) => {
          Logger.error('[Audible] query search error', error.message)
          return []
        })
    }
    // NOTE: items is null when the catalog response has no "products" and this throws (existing behaviour)
    return items!.filter((item): item is AudnexusBook => Boolean(item)).map((item) => this.cleanResult(item)) || []
  }
}

export = Audible
