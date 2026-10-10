import axios, { AxiosError } from 'axios'
import Logger = require('../Logger')

interface GoogleBooksIndustryIdentifier {
  type: string
  identifier?: string
}

/**
 * Volume info as returned by the Google Books volumes endpoint (only the fields used)
 */
interface GoogleBooksVolumeInfo {
  title: string
  subtitle?: string
  authors?: string[]
  publisher?: string
  /** NOTE: the Google Books API field is "publishedDate", this field never exists (existing behaviour) */
  publisherDate?: string
  description?: string
  industryIdentifiers?: GoogleBooksIndustryIdentifier[]
  categories?: string[]
  imageLinks?: Record<string, string>
}

interface GoogleBooksVolume {
  id: string
  volumeInfo?: GoogleBooksVolumeInfo
}

interface GoogleBooksVolumesResponse {
  items?: GoogleBooksVolume[]
}

interface GoogleBooksResult {
  id: string
  title: string
  subtitle: string | null
  author: string | null
  publisher: string | undefined
  publishedYear: string | null
  description: string | undefined
  cover: string | null
  genres: string[] | null
  isbn: string | null
}

class GoogleBooks {
  #responseTimeout = 10000

  constructor() {}

  extractIsbn(industryIdentifiers: GoogleBooksIndustryIdentifier[] | undefined): string | null {
    if (!industryIdentifiers || !industryIdentifiers.length) return null

    var isbnObj = industryIdentifiers.find((i) => i.type === 'ISBN_13') || industryIdentifiers.find((i) => i.type === 'ISBN_10')
    if (isbnObj && isbnObj.identifier) return isbnObj.identifier
    return null
  }

  cleanResult(item: GoogleBooksVolume): GoogleBooksResult | null {
    var { id, volumeInfo } = item
    if (!volumeInfo) return null
    const { title, subtitle, authors, publisher, publisherDate, description, industryIdentifiers, categories, imageLinks } = volumeInfo

    let cover: string | null = null
    // Selects the largest cover assuming the largest is the last key in the object
    if (imageLinks && Object.keys(imageLinks).length) {
      // cast(d): imageLinks has keys (checked above), so pop is not undefined
      cover = imageLinks[Object.keys(imageLinks).pop()!]
      cover = cover?.replace(/^http:/, 'https:') || null
    }

    return {
      id,
      title,
      subtitle: subtitle || null,
      author: authors ? authors.join(', ') : null,
      publisher,
      publishedYear: publisherDate ? publisherDate.split('-')[0] : null,
      description,
      cover,
      genres: categories && Array.isArray(categories) ? [...categories] : null,
      isbn: this.extractIsbn(industryIdentifiers)
    }
  }

  /**
   * Search for a book by title and author
   * @param timeout response timeout in ms
   **/
  async search(title: string, author: string | null | undefined, timeout: number = this.#responseTimeout): Promise<(GoogleBooksResult | null)[]> {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    title = encodeURIComponent(title)
    let queryString = `q=intitle:${title}`
    if (author) {
      author = encodeURIComponent(author)
      queryString += `+inauthor:${author}`
    }
    const url = `https://www.googleapis.com/books/v1/volumes?${queryString}`
    Logger.debug(`[GoogleBooks] Search url: ${url}`)
    const items = await axios
      .get<GoogleBooksVolumesResponse>(url, {
        timeout
      })
      .then((res) => {
        if (!res || !res.data || !res.data.items) return []
        return res.data.items
      })
      .catch((error: AxiosError) => {
        Logger.error('[GoogleBooks] Volume search error', error.message)
        return []
      })
    return items.map((item) => this.cleanResult(item))
  }
}

export = GoogleBooks
