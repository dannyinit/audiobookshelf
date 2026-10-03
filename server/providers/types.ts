/**
 * Types shared by the metadata providers and the finders that consume them.
 */

export interface SeriesResult {
  series: string
  sequence?: string
}

/**
 * Error object some providers return in place of a result list
 */
export interface ProviderError {
  errorCode: 404 | 500
  errorMsg?: string
}

/**
 * Common shape of a book search result across all book providers.
 * Each provider returns a subset of these fields.
 * `descriptionPlain` and `matchConfidence` are added by BookFinder.
 */
export interface BookSearchResult {
  id?: string | number
  title?: string
  subtitle?: string | null
  author?: string | null
  narrator?: string | null
  publisher?: string | null
  publishedYear?: string | number | null
  description?: string | null
  descriptionPlain?: string
  cover?: string | null
  covers?: string[]
  isbn?: string | null
  asin?: string
  genres?: string[] | null
  tags?: string[] | null
  series?: SeriesResult[] | null
  language?: string | null
  duration?: number
  matchConfidence?: number | null
}
