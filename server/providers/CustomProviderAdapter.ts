import axios, { AxiosError, AxiosRequestConfig } from 'axios'
import Database = require('../Database')
import Logger = require('../Logger')
import htmlSanitizer = require('../utils/htmlSanitizer')
import CustomMetadataProvider = require('../models/CustomMetadataProvider')
import type { SeriesResult } from './types'

/**
 * The CustomMetadataProvider model overrides the static init() signature so it is not
 * recognised as a sequelize ModelStatic, this types the one inherited query used here
 */
interface CustomMetadataProviderFinder {
  findByPk(id: string): Promise<CustomMetadataProvider | null>
}

/**
 * A match returned by a custom metadata provider.
 * Values come from an external service so they are validated before use.
 * @see custom-metadata-provider-specification.yaml
 */
interface CustomProviderMatch {
  title?: unknown
  subtitle?: unknown
  author?: unknown
  narrator?: unknown
  publisher?: unknown
  publishedYear?: unknown
  description?: unknown
  cover?: unknown
  isbn?: unknown
  asin?: unknown
  genres?: unknown
  tags?: unknown
  series?: unknown
  language?: unknown
  duration?: unknown
}

interface CustomProviderSearchResponse {
  matches?: CustomProviderMatch[]
}

interface CustomProviderBookResult {
  title?: string
  subtitle?: string
  author?: string
  narrator?: string
  publisher?: string
  publishedYear?: string
  description?: string
  cover?: string
  isbn?: string
  asin?: string
  genres?: string[]
  tags?: string[]
  series?: SeriesResult[]
  language?: string
  duration?: number
}

class CustomProviderAdapter {
  #responseTimeout = 10000

  constructor() {}

  /**
   * @param timeout response timeout in ms
   */
  async search(title: string, author: string | null | undefined, isbn: string | null | undefined, providerSlug: string, mediaType: string, timeout: number = this.#responseTimeout): Promise<CustomProviderBookResult[]> {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const providerId = providerSlug.split('custom-')[1]
    // cast(d): typed view from Phase 2, when the model's init() kept it from being a ModelStatic; since batch 3a findByPk is typed on the model
    const provider = await (Database.customMetadataProviderModel as CustomMetadataProviderFinder).findByPk(providerId)

    if (!provider) {
      throw new Error('Custom provider not found for the given id')
    }

    // Setup query params
    const queryObj: Record<string, string> = {
      mediaType,
      query: title
    }
    if (author) {
      queryObj.author = author
    }
    if (isbn) {
      queryObj.isbn = isbn
    }
    const queryString = new URLSearchParams(queryObj).toString()

    const url = `${provider.url}/search?${queryString}`
    Logger.debug(`[CustomMetadataProvider] Search url: ${url}`)

    // Setup headers
    const axiosOptions: AxiosRequestConfig = {
      timeout
    }
    if (provider.authHeaderValue) {
      axiosOptions.headers = {
        Authorization: provider.authHeaderValue
      }
    }

    const matches = await axios
      .get<CustomProviderSearchResponse>(url, axiosOptions)
      .then((res) => {
        if (!res?.data || !Array.isArray(res.data.matches)) return null
        return res.data.matches
      })
      .catch((error: AxiosError) => {
        Logger.error('[CustomMetadataProvider] Search error', error.message)
        return []
      })

    if (!matches) {
      throw new Error('Custom provider returned malformed response')
    }

    const toStringOrUndefined = (value: unknown): string | undefined => {
      if (typeof value === 'string' || typeof value === 'number') return String(value)
      if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) return value.join(',')
      return undefined
    }
    const validateSeriesArray = (series: unknown): SeriesResult[] | undefined => {
      if (!Array.isArray(series) || !series.length) return undefined
      return series
        .map((s: { series?: unknown; sequence?: unknown } | null | undefined) => {
          if (!s?.series || typeof s.series !== 'string') return undefined
          const _series: SeriesResult = {
            series: s.series
          }
          if (s.sequence && (typeof s.sequence === 'string' || typeof s.sequence === 'number')) {
            _series.sequence = String(s.sequence)
          }
          return _series
        })
        .filter((s) => s !== undefined)
    }
    /**
     * Validates and dedupes tags/genres array
     * Can be comma separated string or array of strings
     */
    const validateTagsGenresArray = (tagsGenres: unknown): string[] | undefined => {
      if (!tagsGenres || (typeof tagsGenres !== 'string' && !Array.isArray(tagsGenres))) return undefined

      let tagsGenresList: string[]
      // If string, split by comma and trim each item
      if (typeof tagsGenres === 'string') tagsGenresList = tagsGenres.split(',')
      // If array, ensure all items are strings
      else if (!tagsGenres.every((t): t is string => typeof t === 'string')) return undefined
      else tagsGenresList = tagsGenres

      // Trim and filter out empty strings
      tagsGenresList = tagsGenresList.map((t) => t.trim()).filter(Boolean)
      if (!tagsGenresList.length) return undefined

      // Dedup
      return [...new Set(tagsGenresList)]
    }

    // re-map keys to throw out
    return matches.map((match) => {
      const { title, subtitle, author, narrator, publisher, publishedYear, description, cover, isbn, asin, genres, tags, series, language, duration } = match

      const payload: CustomProviderBookResult = {
        title: toStringOrUndefined(title),
        subtitle: toStringOrUndefined(subtitle),
        author: toStringOrUndefined(author),
        narrator: toStringOrUndefined(narrator),
        publisher: toStringOrUndefined(publisher),
        publishedYear: toStringOrUndefined(publishedYear),
        description: description && typeof description === 'string' ? htmlSanitizer.sanitize(description) : undefined,
        cover: toStringOrUndefined(cover),
        isbn: toStringOrUndefined(isbn),
        asin: toStringOrUndefined(asin),
        genres: validateTagsGenresArray(genres),
        tags: validateTagsGenresArray(tags),
        series: validateSeriesArray(series),
        language: toStringOrUndefined(language),
        duration: !isNaN(Number(duration)) && duration !== null ? Number(duration) : undefined
      }

      // Remove undefined values
      for (const key in payload) {
        // cast(d): for...in only yields keys of payload
        if (payload[key as keyof CustomProviderBookResult] === undefined) {
          // cast(d): for...in only yields keys of payload
          delete payload[key as keyof CustomProviderBookResult]
        }
      }

      return payload
    })
  }
}

export = CustomProviderAdapter
