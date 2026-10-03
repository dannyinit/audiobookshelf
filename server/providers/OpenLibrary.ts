import axios, { AxiosError } from 'axios'
import type { ProviderError } from './types'

/**
 * Edition as returned by the Open Library ISBN endpoint
 * @see https://openlibrary.org/dev/docs/api/books
 */
type OpenLibraryEdition = Record<string, unknown>

/**
 * Works data as returned by the Open Library works endpoint (only the fields used)
 */
interface OpenLibraryWorks {
  covers?: number[]
  description?: string | { value?: string }
  first_publish_date?: string
}

interface OpenLibraryWorksResult {
  id: string | undefined
  key: string
  covers: string[]
  first_publish_date: string | undefined
  description: string | null
}

/**
 * Search doc as returned by the Open Library search endpoint (only the fields used)
 */
interface OpenLibrarySearchDoc {
  key: string
  title: string
  author_name?: string[]
  first_publish_year?: number
  cover_edition_key?: string
}

interface OpenLibrarySearchResponse {
  docs: OpenLibrarySearchDoc[]
}

/**
 * Search result. When the works request fails the error fields are spread in instead of the works data
 */
type OpenLibraryBookResult = {
  title: string
  author: string | null
  publishedYear: string | null
  edition: string | undefined
  cover: string | null
} & (OpenLibraryWorksResult | ProviderError)

class OpenLibrary {
  #responseTimeout = 10000

  baseUrl: string

  constructor() {
    this.baseUrl = 'https://openlibrary.org'
  }

  get<T>(uri: string, timeout: number = this.#responseTimeout): Promise<T | null> {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout
    return axios
      .get<T>(`${this.baseUrl}/${uri}`, {
        timeout
      })
      .then((res) => {
        return res.data
      })
      .catch((error: AxiosError) => {
        console.error('Failed', error.message)
        return null
      })
  }

  async isbnLookup(isbn: string): Promise<OpenLibraryEdition | ProviderError> {
    var lookupData = await this.get<OpenLibraryEdition>(`/isbn/${isbn}`)
    if (!lookupData) {
      return {
        errorCode: 404
      }
    }
    return lookupData
  }

  async getWorksData(worksKey: string): Promise<OpenLibraryWorksResult | ProviderError> {
    var worksData = await this.get<OpenLibraryWorks>(`${worksKey}.json`)
    if (!worksData) {
      return {
        errorMsg: 'Works Data Request failed',
        errorCode: 500
      }
    }
    if (!worksData.covers) worksData.covers = []
    var coverImages = worksData.covers.filter((c) => c > 0).map((c) => `https://covers.openlibrary.org/b/id/${c}-L.jpg`)
    var description: string | null = null
    if (worksData.description) {
      if (typeof worksData.description === 'string') {
        description = worksData.description
      } else {
        description = worksData.description.value || null
      }
    }
    return {
      id: worksKey.split('/').pop(),
      key: worksKey,
      covers: coverImages,
      first_publish_date: worksData.first_publish_date,
      description: description
    }
  }

  parsePublishYear(doc: OpenLibrarySearchDoc, worksData: OpenLibraryWorksResult | ProviderError): string | null {
    if (doc.first_publish_year && !isNaN(doc.first_publish_year)) return String(doc.first_publish_year)
    const firstPublishDate = 'first_publish_date' in worksData ? worksData.first_publish_date : undefined
    if (firstPublishDate) {
      var year = firstPublishDate.split('-')[0]
      if (!isNaN(Number(year))) return String(year)
    }
    return null
  }

  async cleanSearchDoc(doc: OpenLibrarySearchDoc): Promise<OpenLibraryBookResult> {
    var worksData = await this.getWorksData(doc.key)
    return {
      title: doc.title,
      author: doc.author_name ? doc.author_name.join(', ') : null,
      publishedYear: this.parsePublishYear(doc, worksData),
      edition: doc.cover_edition_key,
      cover: doc.cover_edition_key ? `https://covers.openlibrary.org/b/OLID/${doc.cover_edition_key}-L.jpg` : null,
      ...worksData
    }
  }

  async search(query: Record<string, string>): Promise<OpenLibraryBookResult[] | ProviderError> {
    var queryString = Object.keys(query)
      .map((key) => key + '=' + query[key])
      .join('&')
    var lookupData = await this.get<OpenLibrarySearchResponse>(`/search.json?${queryString}`)
    if (!lookupData) {
      return {
        errorCode: 404
      }
    }
    var searchDocs = await Promise.all(lookupData.docs.map((d) => this.cleanSearchDoc(d)))
    return searchDocs
  }

  async searchTitle(title: string, timeout: number = this.#responseTimeout): Promise<OpenLibraryBookResult[] | ProviderError> {
    title = encodeURIComponent(title)
    var lookupData = await this.get<OpenLibrarySearchResponse>(`/search.json?title=${title}`, timeout)
    if (!lookupData) {
      return {
        errorCode: 404
      }
    }
    var searchDocs = await Promise.all(lookupData.docs.map((d) => this.cleanSearchDoc(d)))
    return searchDocs
  }
}

namespace OpenLibrary {
  export type BookResult = OpenLibraryBookResult
}

export = OpenLibrary
