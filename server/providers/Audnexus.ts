import axios, { AxiosError, AxiosResponse } from 'axios'
import Throttle = require('p-throttle')
import Logger = require('../Logger')
import utils = require('../utils/index')

const { levenshteinDistance } = utils
const { isValidASIN } = utils

/**
 * Author entry as returned by the audnex.us authors search endpoint
 */
interface AuthorASINObj {
  asin: string
  name: string
}

/**
 * Author as returned by the audnex.us author endpoint (only the fields used)
 */
interface AudnexusAuthor {
  asin: string
  name: string
  description: string
  image?: string
}

/**
 * Chapters as returned by the audnex.us book chapters endpoint
 */
interface AudnexusChapter {
  lengthMs: number
  startOffsetMs: number
  startOffsetSec: number
  title: string
}

interface AudnexusChapters {
  asin: string
  brandIntroDurationMs: number
  brandOutroDurationMs: number
  chapters: AudnexusChapter[]
  isAccurate: boolean
  region: string
  runtimeLengthMs: number
  runtimeLengthSec: number
}

/**
 * Shape of the error thrown by axios that _processRequest inspects
 */
interface RequestError {
  response?: {
    status?: number
    headers?: Record<string, string | undefined>
  }
}

class Audnexus {
  static _instance: Audnexus | null = null

  baseUrl!: string
  limiter!: <Argument extends readonly unknown[], ReturnValue>(function_: (...arguments_: Argument) => ReturnValue) => Throttle.ThrottledFunction<Argument, ReturnValue>

  constructor() {
    // ensures Audnexus class is singleton
    if (Audnexus._instance) {
      return Audnexus._instance
    }

    this.baseUrl = 'https://api.audnex.us'

    // Rate limit is 100 requests per minute.
    // @see https://github.com/laxamentumtech/audnexus#-deployment-
    this.limiter = Throttle({
      // Setting the limit to 1 allows for a short pause between requests that is imperceptible to the end user.
      // A larger limit will grab blocks faster and then wait for the alloted time(interval) before
      // fetching another batch, but with a discernable pause from the user perspective.
      limit: 1,
      strict: true,
      interval: 150
    })

    Audnexus._instance = this
  }

  authorASINsRequest(name: string, region?: string): Promise<AuthorASINObj[]> {
    const searchParams = new URLSearchParams()
    searchParams.set('name', name)

    if (region) searchParams.set('region', region)

    const authorRequestUrl = `${this.baseUrl}/authors?${searchParams.toString()}`
    Logger.info(`[Audnexus] Searching for author "${authorRequestUrl}"`)

    return this._processRequest(this.limiter(() => axios.get<AuthorASINObj[]>(authorRequestUrl)))
      .then((res) => res.data || [])
      .catch((error: AxiosError) => {
        Logger.error(`[Audnexus] Author ASIN request failed for ${name}`, error.message)
        return []
      })
  }

  authorRequest(asin: string, region?: string): Promise<AudnexusAuthor | null> | null {
    if (!isValidASIN(asin?.toUpperCase?.())) {
      Logger.error(`[Audnexus] Invalid ASIN ${asin}`)
      return null
    }

    asin = encodeURIComponent(asin.toUpperCase())

    const authorRequestUrl = new URL(`${this.baseUrl}/authors/${asin}`)
    if (region) authorRequestUrl.searchParams.set('region', region)

    Logger.info(`[Audnexus] Searching for author "${authorRequestUrl}"`)

    return this._processRequest(this.limiter(() => axios.get<AudnexusAuthor>(authorRequestUrl.toString())))
      .then((res) => res.data)
      .catch((error: AxiosError) => {
        Logger.error(`[Audnexus] Author request failed for ${asin}`, error.message)
        return null
      })
  }

  async findAuthorByASIN(asin: string, region?: string): Promise<Audnexus.AuthorSearchObj | null> {
    const author = await this.authorRequest(asin, region)

    return author
      ? {
          asin: author.asin,
          description: author.description,
          image: author.image || null,
          name: author.name
        }
      : null
  }

  async findAuthorByName(name: string, region?: string, maxLevenshtein: number = 3): Promise<Audnexus.AuthorSearchObj | null> {
    Logger.debug(`[Audnexus] Looking up author by name ${name}`)
    const authorAsinObjs = await this.authorASINsRequest(name, region)

    let closestMatch = null as (AuthorASINObj & { levenshteinDistance: number }) | null
    authorAsinObjs.forEach((authorAsinObj) => {
      const scoredAuthorAsinObj = Object.assign(authorAsinObj, { levenshteinDistance: levenshteinDistance(authorAsinObj.name, name) })
      if (!closestMatch || closestMatch.levenshteinDistance > scoredAuthorAsinObj.levenshteinDistance) {
        closestMatch = scoredAuthorAsinObj
      }
    })

    if (!closestMatch || closestMatch.levenshteinDistance > maxLevenshtein) {
      return null
    }

    const author = await this.authorRequest(closestMatch.asin, region)
    if (!author) {
      return null
    }

    return {
      asin: author.asin,
      description: author.description,
      image: author.image || null,
      name: author.name
    }
  }

  getChaptersByASIN(asin: string, region: string): Promise<AudnexusChapters | null> {
    Logger.debug(`[Audnexus] Get chapters for ASIN ${asin}/${region}`)

    asin = encodeURIComponent(asin.toUpperCase())
    const chaptersRequestUrl = new URL(`${this.baseUrl}/books/${asin}/chapters`)
    if (region) chaptersRequestUrl.searchParams.set('region', region)

    return this._processRequest(this.limiter(() => axios.get<AudnexusChapters>(chaptersRequestUrl.toString())))
      .then((res) => res.data)
      .catch((error: AxiosError) => {
        Logger.error(`[Audnexus] Chapter ASIN request failed for ${asin}/${region}`, error.message)
        return null
      })
  }

  /**
   * Internal method to process requests and retry if rate limit is exceeded.
   */
  async _processRequest<T>(request: () => Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> {
    try {
      return await request()
    } catch (error) {
      const requestError = error as RequestError
      if (requestError.response?.status === 429) {
        const retryAfter = parseInt(String(requestError.response.headers?.['retry-after']), 10) || 5

        Logger.warn(`[Audnexus] Rate limit exceeded. Retrying in ${retryAfter} seconds.`)
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))

        return this._processRequest(request)
      }

      throw error
    }
  }
}

namespace Audnexus {
  export interface AuthorSearchObj {
    asin: string
    description: string
    image: string | null
    name: string
  }
}

export = Audnexus
