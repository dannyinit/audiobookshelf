import type { Request, Response } from 'express'
import Logger = require('../Logger')
import BookFinder = require('../finders/BookFinder')
import PodcastFinder = require('../finders/PodcastFinder')
import AuthorFinder = require('../finders/AuthorFinder')
import Database = require('../Database')
import utils = require('../utils')
import CustomMetadataProvider = require('../models/CustomMetadataProvider')
import User = require('../models/User')

const { isValidASIN, getQueryParamAsString, ValidationError, NotFoundError } = utils

// Provider name mappings for display purposes
const providerMap: Record<string, string> = {
  all: 'All',
  best: 'Best',
  google: 'Google Books',
  itunes: 'iTunes',
  openlibrary: 'Open Library',
  fantlab: 'FantLab.ru',
  audiobookcovers: 'AudiobookCovers.com',
  audible: 'Audible.com',
  'audible.ca': 'Audible.ca',
  'audible.uk': 'Audible.co.uk',
  'audible.au': 'Audible.com.au',
  'audible.fr': 'Audible.fr',
  'audible.de': 'Audible.de',
  'audible.jp': 'Audible.co.jp',
  'audible.it': 'Audible.it',
  'audible.in': 'Audible.in',
  'audible.es': 'Audible.es',
  audnexus: 'Audnexus'
}

type RequestWithUser = Request & { user: User }

interface ProviderOption {
  value: string
  text: string
}

/**
 * The CustomMetadataProvider model overrides the static init() signature so it is not
 * recognised as a sequelize ModelStatic, this types the one inherited query used here
 */
interface CustomMetadataProviderLister {
  findAll(): Promise<CustomMetadataProvider[]>
}

class SearchController {
  constructor() {}

  /**
   * Fetches a library item by ID
   * @param id - Library item ID
   */
  static async fetchLibraryItem(id: string) {
    const libraryItem = await Database.libraryItemModel.getExpandedById(id)
    if (!libraryItem) {
      throw new NotFoundError(`library item "${id}" not found`)
    }
    return libraryItem
  }

  /**
   * Maps custom metadata providers to standardized format
   * @param providers - Array of custom provider objects
   */
  static mapCustomProviders(providers: CustomMetadataProvider[]): ProviderOption[] {
    return providers.map((provider) => ({
      value: provider.getSlug(),
      text: provider.name
    }))
  }

  /**
   * Static helper method to format provider for client (for use in array methods)
   * @param providerValue - Provider identifier
   */
  static formatProvider(providerValue: string): ProviderOption {
    return {
      value: providerValue,
      text: providerMap[providerValue] || providerValue
    }
  }

  /**
   * GET: /api/search/books
   */
  async findBooks(req: RequestWithUser, res: Response) {
    try {
      const query = req.query
      const provider = getQueryParamAsString(query, 'provider', 'google')
      const title = getQueryParamAsString(query, 'title', '')
      const author = getQueryParamAsString(query, 'author', '')
      const id = getQueryParamAsString(query, 'id', undefined)

      // Fetch library item
      const libraryItem = id ? await SearchController.fetchLibraryItem(id) : null

      const results = await BookFinder.search(libraryItem, provider, title, author)
      res.json(results)
    } catch (error) {
      // cast(d): catch variable is unknown; the finders and validation helpers throw Error objects
      Logger.error(`[SearchController] findBooks: ${(error as Error).message}`)
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        return res.status(error.status).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET: /api/search/covers
   */
  async findCovers(req: RequestWithUser, res: Response) {
    try {
      // Widened to unknown values since the podcast param is also compared against a number
      const query: Record<string, unknown> = req.query
      const podcast = query.podcast === '1' || query.podcast === 1
      const title = getQueryParamAsString(query, 'title', '', true)
      const author = getQueryParamAsString(query, 'author', '')
      const provider = getQueryParamAsString(query, 'provider', 'google')

      let results: string[] | null = null
      if (podcast) results = await PodcastFinder.findCovers(title)
      else results = await BookFinder.findCovers(provider, title, author)
      res.json({ results })
    } catch (error) {
      // cast(d): catch variable is unknown; the finders and validation helpers throw Error objects
      Logger.error(`[SearchController] findCovers: ${(error as Error).message}`)
      if (error instanceof ValidationError) {
        return res.status(error.status).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET: /api/search/podcasts
   * Find podcast RSS feeds given a term
   */
  async findPodcasts(req: RequestWithUser, res: Response) {
    try {
      const query = req.query
      const term = getQueryParamAsString(query, 'term', '', true)
      const country = getQueryParamAsString(query, 'country', 'us')

      const results = await PodcastFinder.search(term, { country })
      res.json(results)
    } catch (error) {
      // cast(d): catch variable is unknown; the finders and validation helpers throw Error objects
      Logger.error(`[SearchController] findPodcasts: ${(error as Error).message}`)
      if (error instanceof ValidationError) {
        return res.status(error.status).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET: /api/search/authors
   * Note: This endpoint is not currently used in the web client.
   */
  async findAuthor(req: RequestWithUser, res: Response) {
    try {
      const query = getQueryParamAsString(req.query, 'q', '', true)

      const author = await AuthorFinder.findAuthorByName(query)
      res.json(author)
    } catch (error) {
      // cast(d): catch variable is unknown; the finders and validation helpers throw Error objects
      Logger.error(`[SearchController] findAuthor: ${(error as Error).message}`)
      if (error instanceof ValidationError) {
        return res.status(error.status).json({ error: error.message })
      }
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET: /api/search/chapters
   */
  async findChapters(req: RequestWithUser, res: Response) {
    try {
      const query = req.query
      const asin = getQueryParamAsString(query, 'asin', '', true)
      const region = getQueryParamAsString(query, 'region', 'us').toLowerCase()

      if (!isValidASIN(asin.toUpperCase())) throw new ValidationError('asin', 'is invalid')

      const chapterData = await BookFinder.findChapters(asin, region)
      if (!chapterData) {
        return res.json({ error: 'Chapters not found', stringKey: 'MessageChaptersNotFound' })
      }
      res.json(chapterData)
    } catch (error) {
      // cast(d): catch variable is unknown; the finders and validation helpers throw Error objects
      Logger.error(`[SearchController] findChapters: ${(error as Error).message}`)
      if (error instanceof ValidationError) {
        if (error.paramName === 'asin') {
          return res.json({ error: 'Invalid ASIN', stringKey: 'MessageInvalidAsin' })
        }
        if (error.paramName === 'region') {
          return res.json({ error: 'Invalid region', stringKey: 'MessageInvalidRegion' })
        }
      }
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET: /api/search/providers
   * Get all available metadata providers
   */
  async getAllProviders(req: RequestWithUser, res: Response) {
    // cast(d): typed view from Phase 2, when the model's init() kept it from being a ModelStatic; since batch 3a findAll is typed on the model
    const customProviders = await (Database.customMetadataProviderModel as CustomMetadataProviderLister).findAll()

    const customBookProviders = customProviders.filter((p) => p.mediaType === 'book')
    const customPodcastProviders = customProviders.filter((p) => p.mediaType === 'podcast')

    const bookProviders = BookFinder.providers.filter((p) => p !== 'audiobookcovers')

    // Build minimized payload with custom providers merged in
    const providers = {
      books: [...bookProviders.map((p) => SearchController.formatProvider(p)), ...SearchController.mapCustomProviders(customBookProviders)],
      booksCovers: [SearchController.formatProvider('best'), ...BookFinder.providers.map((p) => SearchController.formatProvider(p)), ...SearchController.mapCustomProviders(customBookProviders), SearchController.formatProvider('all')],
      podcasts: [SearchController.formatProvider('itunes'), ...SearchController.mapCustomProviders(customPodcastProviders)]
    }

    res.json({ providers })
  }
}
export = new SearchController()
