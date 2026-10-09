import Logger = require('../../Logger')
import parseSeriesString = require('../parsers/parseSeriesString')

type ExpectedValueType = 'string' | 'boolean' | 'stringArray'

const mediaTypeKeys: Record<string, Record<string, ExpectedValueType>> = {
  book: {
    tags: 'stringArray',
    title: 'string',
    subtitle: 'string',
    authors: 'stringArray',
    narrators: 'stringArray',
    series: 'stringArray',
    genres: 'stringArray',
    publishedYear: 'string',
    publishedDate: 'string',
    publisher: 'string',
    description: 'string',
    isbn: 'string',
    asin: 'string',
    language: 'string',
    explicit: 'boolean',
    abridged: 'boolean'
  },
  podcast: {
    tags: 'stringArray',
    title: 'string',
    author: 'string',
    description: 'string',
    releaseDate: 'string',
    genres: 'stringArray',
    feedURL: 'string',
    imageURL: 'string',
    itunesPageURL: 'string',
    itunesId: 'string',
    itunesArtistId: 'string',
    asin: 'string',
    language: 'string',
    explicit: 'boolean',
    podcastType: 'string'
  }
}

interface AbMetadataChapter {
  id: number
  start: number
  end: number
  title: string
}

/**
 * Validated metadata.json values keyed by model field
 */
type ValidatedAbMetadata = Record<string, unknown> & {
  title?: string | null
  series?: unknown[]
  chapters?: AbMetadataChapter[]
  /** Validated as arrays (see the expected keys) */
  authors?: unknown[]
  genres?: unknown[]
  tags?: unknown[]
}

function parseJsonMetadataText(text: string, mediaType: 'book' | 'podcast'): ValidatedAbMetadata | null {
  try {
    const abmetadataData: Record<string, unknown> & { metadata?: Record<string, unknown>; title?: string; chapters?: unknown } = JSON.parse(text)

    // Old metadata.json used nested "metadata"
    if (abmetadataData.metadata) {
      for (const key in abmetadataData.metadata) {
        if (abmetadataData.metadata[key] === undefined) continue
        let newModelKey = key
        if (key === 'feedUrl') newModelKey = 'feedURL'
        else if (key === 'imageUrl') newModelKey = 'imageURL'
        else if (key === 'itunesPageUrl') newModelKey = 'itunesPageURL'
        else if (key === 'type') newModelKey = 'podcastType'
        abmetadataData[newModelKey] = abmetadataData.metadata[key]
      }
    }
    delete abmetadataData.metadata

    const expectedKeys = mediaTypeKeys[mediaType]
    if (!expectedKeys) {
      Logger.error(`[abmetadataGenerator] Invalid media type "${mediaType}"`)
      return null
    }

    const validated: ValidatedAbMetadata = {}
    for (const key in expectedKeys) {
      const expectedType = expectedKeys[key]
      if (!(key in abmetadataData)) continue

      const validatedValue = validateMetadataValue(key, abmetadataData[key], expectedType)
      if (validatedValue !== undefined) {
        validated[key] = validatedValue
      }
    }

    if (validated.series?.length) {
      validated.series = validated.series.map((series) => parseSeriesString.parse(series)).filter(Boolean)
    }

    if (mediaType === 'book' && 'chapters' in abmetadataData) {
      if (abmetadataData.chapters === null) {
        validated.chapters = []
      } else if (Array.isArray(abmetadataData.chapters)) {
        // validated.title is a validated string value or null
        const cleanedChapters = cleanChaptersArray(abmetadataData.chapters, (validated.title as string | null | undefined) ?? abmetadataData.title)
        if (cleanedChapters) {
          validated.chapters = cleanedChapters
        }
      } else {
        Logger.warn(`[abmetadataGenerator] Invalid metadata key "chapters" expected array, got ${typeof abmetadataData.chapters}`)
      }
    }

    return validated
  } catch (error) {
    Logger.error(`[abmetadataGenerator] Invalid metadata.json JSON`, error)
    return null
  }
}

/**
 * @returns undefined excludes the key
 */
function validateMetadataValue(key: string, value: unknown, expectedType: string): string | boolean | string[] | null | undefined {
  if (expectedType === 'string') {
    if (value === null) return null
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string') return value
    Logger.warn(`[abmetadataGenerator] Invalid metadata key "${key}" expected string, got ${typeof value}`)
    return undefined
  }

  if (expectedType === 'boolean') {
    if (value === null) return null
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const lower = value.toLowerCase()
      if (lower === 'true') return true
      if (lower === 'false') return false
    }
    Logger.warn(`[abmetadataGenerator] Invalid metadata key "${key}" expected boolean, got ${typeof value}`)
    return undefined
  }

  // Filter empty strings and deduplicate
  if (expectedType === 'stringArray') {
    if (value === null) return []
    if (!Array.isArray(value)) {
      Logger.warn(`[abmetadataGenerator] Invalid metadata key "${key}" expected string array, got ${typeof value}`)
      return undefined
    }

    const cleanedArray = value.filter((t): t is string => typeof t === 'string')
    return [...new Set(cleanedArray.map((t) => t.trim()).filter((t) => t))]
  }

  Logger.warn(`[abmetadataGenerator] Unknown expected type "${expectedType}" for key "${key}"`)
  return undefined
}

function cleanChaptersArray(chaptersArray: { start: number | null; end: number | null; title: unknown }[], mediaTitle: string | null | undefined): AbMetadataChapter[] | null {
  const chapters: AbMetadataChapter[] = []
  let index = 0
  for (const chap of chaptersArray) {
    if (chap.start === null || isNaN(chap.start)) {
      Logger.error(`[abmetadataGenerator] Invalid chapter start time ${chap.start} for "${mediaTitle}" metadata file`)
      return null
    }
    if (chap.end === null || isNaN(chap.end)) {
      Logger.error(`[abmetadataGenerator] Invalid chapter end time ${chap.end} for "${mediaTitle}" metadata file`)
      return null
    }
    if (!chap.title || typeof chap.title !== 'string') {
      Logger.error(`[abmetadataGenerator] Invalid chapter title ${chap.title} for "${mediaTitle}" metadata file`)
      return null
    }

    chapters.push({
      id: index++,
      start: chap.start,
      end: chap.end,
      title: chap.title
    })
  }
  return chapters
}

export = { parseJson: parseJsonMetadataText }
