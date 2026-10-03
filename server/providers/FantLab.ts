import axios, { AxiosError } from 'axios'
import Logger = require('../Logger')

/**
 * Work as returned by the FantLab search-works endpoint (only the fields used)
 */
interface FantLabSearchItem {
  work_id: number
  work_type_id: number
}

interface FantLabGenre {
  label: string
  genre?: FantLabGenre[]
}

interface FantLabGenreGroup {
  genre_group_id: number
  genre?: FantLabGenre[]
}

interface FantLabClassificatory {
  genre_group?: FantLabGenreGroup[]
}

interface FantLabEdition {
  edition_id: number
  isbn?: string
}

interface FantLabEditionsBlock {
  list?: FantLabEdition[]
}

/**
 * Editions grouped by type id (30 = audio, 10 = paper)
 */
type FantLabEditionsBlocks = Record<string, FantLabEditionsBlock | undefined>

/**
 * Work as returned by the FantLab work extended endpoint (only the fields used)
 */
interface FantLabWork {
  authors: { name?: string }[]
  work_name_alts?: string[]
  work_id: number
  work_name: string
  work_year: number
  work_description: string
  image: string
  classificatory?: FantLabClassificatory
  editions_blocks?: FantLabEditionsBlocks
}

interface FantLabEditionInfo {
  image?: string
}

interface FantLabBookResult {
  id: number
  title: string
  subtitle: string | null
  author: string | null
  publisher: null
  publishedYear: number
  description: string
  cover: string | null
  genres: string[]
  isbn: string | null
}

class FantLab {
  #responseTimeout = 10000
  // 7 - other
  // 11 - essay
  // 12 - article
  // 22 - disser
  // 23 - monography
  // 24 - study
  // 25 - encyclopedy
  // 26 - magazine
  // 46 - sketch
  // 47 - reportage
  // 49 - excerpt
  // 51 - interview
  // 52 - review
  // 55 - libretto
  // 56 - anthology series
  // 57 - newspaper
  // types can get here https://api.fantlab.ru/config.json
  _filterWorkType = [7, 11, 12, 22, 23, 24, 25, 26, 46, 47, 49, 51, 52, 55, 56, 57]
  _baseUrl = 'https://api.fantlab.ru'

  constructor() {}

  /**
   * @param timeout response timeout in ms
   **/
  async search(title: string, author: string | null | undefined, timeout: number = this.#responseTimeout): Promise<FantLabBookResult[]> {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    let searchString = encodeURIComponent(title)
    if (author) {
      searchString += encodeURIComponent(' ' + author)
    }
    const url = `${this._baseUrl}/search-works?q=${searchString}&page=1&onlymatches=1`
    Logger.debug(`[FantLab] Search url: ${url}`)
    const items = await axios
      .get<FantLabSearchItem[]>(url, {
        timeout
      })
      .then((res) => {
        return res.data || []
      })
      .catch((error: AxiosError) => {
        Logger.error('[FantLab] search error', error.message)
        return []
      })

    return Promise.all(items.map(async (item) => await this.getWork(item, timeout))).then((resArray) => resArray.filter((res): res is FantLabBookResult => Boolean(res)))
  }

  /**
   * @param timeout response timeout in ms
   **/
  async getWork(item: FantLabSearchItem, timeout: number = this.#responseTimeout): Promise<FantLabBookResult | null> {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout
    const { work_id, work_type_id } = item

    if (this._filterWorkType.includes(work_type_id)) {
      return null
    }

    const url = `${this._baseUrl}/work/${work_id}/extended`
    const bookData = await axios
      .get<FantLabWork>(url, {
        timeout
      })
      .then((resp) => {
        return resp.data || null
      })
      .catch((error: AxiosError) => {
        Logger.error(`[FantLab] work info request for url "${url}" error`, error.message)
        return null
      })

    if (!bookData) {
      return null
    }

    return this.cleanBookData(bookData, timeout)
  }

  async cleanBookData(bookData: FantLabWork, timeout: number = this.#responseTimeout): Promise<FantLabBookResult> {
    let { authors, work_name_alts, work_id, work_name, work_year, work_description, image, classificatory, editions_blocks } = bookData

    const subtitle = Array.isArray(work_name_alts) ? work_name_alts[0] : null
    const authorNames = authors.map((au) => (au.name || '').trim()).filter((au) => au)

    const imageAndIsbn = await this.tryGetCoverFromEditions(editions_blocks, timeout)

    const imageToUse = imageAndIsbn?.imageUrl || image

    return {
      id: work_id,
      title: work_name,
      subtitle: subtitle || null,
      author: authorNames.length ? authorNames.join(', ') : null,
      publisher: null,
      publishedYear: work_year,
      description: work_description,
      cover: imageToUse ? `https://fantlab.ru${imageToUse}` : null,
      genres: this.tryGetGenres(classificatory),
      isbn: imageAndIsbn?.isbn || null
    }
  }

  tryGetGenres(classificatory: FantLabClassificatory | undefined): string[] {
    if (!classificatory || !classificatory.genre_group) return []

    const genresGroup = classificatory.genre_group.find((group) => group.genre_group_id == 1) // genres and subgenres

    // genre_group_id=2 - General Characteristics
    // genre_group_id=3 - Arena
    // genre_group_id=4 - Duration of action
    // genre_group_id=6 - Story moves
    // genre_group_id=7 - Story linearity
    // genre_group_id=5 - Recommended age of the reader

    if (!genresGroup || !genresGroup.genre || !genresGroup.genre.length) return []

    const rootGenre = genresGroup.genre[0]

    const { label } = rootGenre

    return [label].concat(this.tryGetSubGenres(rootGenre))
  }

  tryGetSubGenres(rootGenre: FantLabGenre): string[] {
    if (!rootGenre.genre || !rootGenre.genre.length) return []
    return rootGenre.genre.map((g) => g.label).filter((g) => g)
  }

  async tryGetCoverFromEditions(editions: FantLabEditionsBlocks | undefined, timeout: number = this.#responseTimeout): Promise<{ imageUrl: string | null; isbn: string | null } | null> {
    if (!editions) {
      return null
    }

    // 30 = audio, 10 = paper
    // Prefer audio if available
    const bookEditions = editions['30'] || editions['10']
    if (!bookEditions || !bookEditions.list || !bookEditions.list.length) {
      return null
    }

    const lastEdition = bookEditions.list.pop()!

    const editionId = lastEdition['edition_id']
    const isbn = lastEdition['isbn'] || null // get only from paper edition

    return {
      imageUrl: await this.getCoverFromEdition(editionId, timeout),
      isbn
    }
  }

  async getCoverFromEdition(editionId: number, timeout: number = this.#responseTimeout): Promise<string | null> {
    if (!editionId) return null
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const url = `${this._baseUrl}/edition/${editionId}`

    const editionInfo = await axios
      .get<FantLabEditionInfo>(url, {
        timeout
      })
      .then((resp) => {
        return resp.data || null
      })
      .catch((error: AxiosError) => {
        Logger.error(`[FantLab] search cover from edition with url "${url}" error`, error.message)
        return null
      })

    return editionInfo?.image || null
  }
}

export = FantLab
