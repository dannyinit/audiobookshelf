import axios from 'axios'
import ssrfFilter from 'ssrf-req-filter'
import Logger = require('../Logger')
import utils = require('./index')
import htmlSanitizer = require('../utils/htmlSanitizer')
import FuseLib = require('../libs/fusejs')
const { xmlToJSON, timestampToSeconds } = utils

/**
 * The vendored fuse.js (v7) build is minified UMD, so its inferred type is unusable. Only the parts used
 */
type FuseConstructor = new <T>(
  docs: T[],
  options: { ignoreDiacritics?: boolean; threshold?: number; keys?: { name: string; weight: number }[] }
) => { search(pattern: string): { item: T; refIndex: number }[] }

// See FuseConstructor
const Fuse = FuseLib as unknown as FuseConstructor

/**
 * xml2js attributes object
 */
type XmlAttributes = Record<string, string | undefined>

/**
 * xml2js element: child elements keyed by tag name (always arrays), attributes under `$` and text under `_`
 */
interface XmlElement {
  $?: XmlAttributes
  _?: string
  [tag: string]: unknown
}

interface RssCategory extends XmlElement {
  'itunes:category'?: RssCategory[]
}

/**
 * <channel> element of an RSS feed as parsed by xml2js (only the fields read directly)
 */
interface RssChannel extends XmlElement {
  image?: XmlElement[]
  'itunes:image'?: XmlElement[]
  'itunes:category'?: RssCategory[]
  'itunes:new-feed-url'?: unknown[]
  'atom:link'?: XmlElement[]
  item?: RssItem[]
}

/**
 * <item> element of an RSS feed as parsed by xml2js (only the fields read directly)
 */
interface RssItem extends XmlElement {
  enclosure?: XmlElement[]
  'media:content'?: XmlElement[]
  'podcast:chapters'?: XmlElement[]
  'psc:chapters'?: { 'psc:chapter'?: XmlElement[] }[]
}

interface RssJson {
  channel?: RssChannel[]
}

interface RssPodcastChapter {
  id: number
  title: string
  start: number
  end: number | null
}

/**
 * Attributes of the <enclosure> (or audio <media:content>) element
 */
type RssPodcastEnclosure = XmlAttributes & {
  url: string
  type?: string
  length?: string
}

/**
 * Episode data extracted from an <item>. Keys from the item are copied in by name
 */
interface RssEpisodeData {
  [key: string]: unknown
  enclosure: RssPodcastEnclosure
  title?: string
  subtitle?: string
  description?: string
  descriptionPlain?: string
  pubDate?: string
  episodeType?: string
  season?: string
  episode?: string
  author?: string
  duration?: string
  durationSeconds?: number | null
  explicit?: string
  guid?: string
  chaptersUrl?: string
  chaptersType?: string
  chapters?: RssPodcastChapter[]
}

interface RssPodcastEpisode {
  title: string | undefined
  subtitle: string
  description: string
  descriptionPlain: string
  pubDate: string
  episodeType: string
  season: string
  episode: string
  author: string
  duration: string
  /** Parsed from duration string if duration is valid */
  durationSeconds: number | null
  explicit: string
  /** Unix timestamp */
  publishedAt: number | null
  enclosure: RssPodcastEnclosure
  guid: string | null
  chaptersUrl: string | null
  chaptersType: string | null
  chapters: RssPodcastChapter[]
}

/**
 * Podcast metadata extracted from the <channel>. Keys from the channel are copied in by name
 * (title, language, explicit, author, pubDate, link, type)
 */
interface RssPodcastMetadata {
  [key: string]: unknown
  image: string | null
  categories: string[]
  feedUrl: unknown
  description: string | null
  descriptionPlain: string | null
  type: unknown
}

interface RssPodcast {
  metadata: RssPodcastMetadata
  episodes?: RssPodcastEpisode[]
  numEpisodes?: number
}

function extractFirstArrayItem(json: XmlElement, key: string): unknown {
  // xml2js puts child elements in arrays
  const values = json[key] as unknown[] | undefined
  if (!values?.length) return null
  return values[0]
}

function extractStringOrStringify(json: XmlElement): string {
  try {
    // xml2js puts child elements in arrays
    const firstValue = json[Object.keys(json)[0]] as unknown[] | undefined
    if (typeof firstValue?.[0] === 'string') {
      return firstValue[0]
    }
    // Handles case where html was included without being wrapped in CDATA
    return JSON.stringify(json)
  } catch {
    return ''
  }
}

function extractFirstArrayItemString(json: XmlElement, key: string): string {
  const item = extractFirstArrayItem(json, key)
  if (!item) return ''
  if (typeof item === 'object') {
    // Objects in xml2js output are elements
    const element = item as XmlElement
    if (element?.['_'] && typeof element['_'] === 'string') return element['_']

    return extractStringOrStringify(element)
  }
  return typeof item === 'string' ? item : ''
}

function extractImage(channel: RssChannel): string | null {
  // NOTE: xml2js puts <image> in an array, so channel.image.url is always undefined and the itunes:image fallback is always used
  // Read as the object the code expects (see NOTE)
  const channelImage = channel.image as { url?: string[] } | undefined
  if (!channelImage || !channelImage.url || !channelImage.url.length) {
    if (!channel['itunes:image'] || !channel['itunes:image'].length || !channel['itunes:image'][0]['$']) {
      return null
    }
    var itunesImage = channel['itunes:image'][0]['$']
    return itunesImage.href || null
  }
  return channelImage.url[0] || null
}

function extractCategories(channel: RssCategory): string[] {
  if (!channel['itunes:category'] || !channel['itunes:category'].length) return []
  var categories = channel['itunes:category']
  var cleanedCats: string[] = []
  categories.forEach((cat) => {
    if (!cat['$'] || !cat['$'].text) return
    var cattext = cat['$'].text
    if (cat['itunes:category']) {
      var subcats = extractCategories(cat)
      if (subcats.length) {
        cleanedCats = cleanedCats.concat(subcats.map((subcat) => `${cattext}:${subcat}`))
      } else {
        cleanedCats.push(cattext)
      }
    } else {
      cleanedCats.push(cattext)
    }
  })
  return cleanedCats
}

function extractPodcastMetadata(channel: RssChannel): RssPodcastMetadata {
  const metadata: RssPodcastMetadata = {
    image: extractImage(channel),
    categories: extractCategories(channel),
    feedUrl: null,
    description: null,
    descriptionPlain: null,
    type: null
  }

  if (channel['itunes:new-feed-url']) {
    metadata.feedUrl = extractFirstArrayItem(channel, 'itunes:new-feed-url')
  } else if (channel['atom:link'] && channel['atom:link'].length && channel['atom:link'][0]['$']) {
    metadata.feedUrl = channel['atom:link'][0]['$'].href || null
  }

  if (channel['description']) {
    const rawDescription = extractFirstArrayItemString(channel, 'description')
    metadata.description = htmlSanitizer.sanitize(rawDescription.trim())
    metadata.descriptionPlain = htmlSanitizer.stripAllTags(rawDescription.trim())
  }

  const arrayFields = ['title', 'language', 'itunes:explicit', 'itunes:author', 'pubDate', 'link', 'itunes:type']
  arrayFields.forEach((key) => {
    // split always returns at least one element
    const cleanKey = key.split(':').pop() as string
    let value = extractFirstArrayItem(channel, key)
    // Reads `_` of an element value; strings and null read undefined, as in the JS
    if ((value as XmlElement | null)?.['_']) value = (value as XmlElement)['_']
    metadata[cleanKey] = value
  })
  return metadata
}

function extractEpisodeData(item: RssItem): RssEpisodeData | null {
  // Episode must have url
  let enclosure: RssPodcastEnclosure

  if (item.enclosure?.[0]?.['$']?.url) {
    // url was checked above
    enclosure = item.enclosure[0]['$'] as RssPodcastEnclosure
  } else if (item['media:content']?.find((c) => c?.['$']?.url && (c?.['$']?.type ?? '').startsWith('audio'))) {
    // NOTE: this second find does not require a url, so it can pick an audio media:content without one and url.trim() below throws
    // The check above found an audio media:content
    enclosure = (item['media:content'].find((c) => (c['$']?.type ?? '').startsWith('audio')) as XmlElement)['$'] as RssPodcastEnclosure
  } else {
    Logger.error(`[podcastUtils] Invalid podcast episode data`)
    return null
  }

  const episode: RssEpisodeData = {
    enclosure: enclosure
  }

  episode.enclosure.url = episode.enclosure.url.trim()

  // Full description with html
  if (item['content:encoded']) {
    const rawDescription = (extractFirstArrayItemString(item, 'content:encoded') || '').trim()
    episode.description = htmlSanitizer.sanitize(rawDescription)
  }

  // Extract chapters
  if (item['podcast:chapters']?.[0]?.['$']?.url) {
    episode.chaptersUrl = item['podcast:chapters'][0]['$'].url
    episode.chaptersType = item['podcast:chapters'][0]['$'].type || 'application/json'
  }

  // Supposed to be the plaintext description but not always followed
  if (item['description']) {
    const rawDescription = extractFirstArrayItemString(item, 'description')

    if (!episode.description) episode.description = htmlSanitizer.sanitize(rawDescription.trim())
    episode.descriptionPlain = htmlSanitizer.stripAllTags(rawDescription.trim())
  }

  if (item['pubDate']) {
    // A non-string value is an element (or null when missing)
    const pubDate = extractFirstArrayItem(item, 'pubDate') as string | XmlElement | null
    if (typeof pubDate === 'string') {
      episode.pubDate = pubDate
    } else if (typeof pubDate?._ === 'string') {
      episode.pubDate = pubDate._
    } else {
      Logger.error(`[podcastUtils] Invalid pubDate ${item['pubDate']} for ${episode.enclosure.url}`)
    }
  }

  if (item['guid']) {
    // A non-string value is an element (or null when missing)
    const guidItem = extractFirstArrayItem(item, 'guid') as string | XmlElement | null
    if (typeof guidItem === 'string') {
      episode.guid = guidItem
    } else if (typeof guidItem?._ === 'string') {
      episode.guid = guidItem._
    } else {
      Logger.error(`[podcastUtils] Invalid guid for ${episode.enclosure.url}`, item['guid'])
    }
  }

  const arrayFields = ['title', 'itunes:episodeType', 'itunes:season', 'itunes:episode', 'itunes:author', 'itunes:duration', 'itunes:explicit', 'itunes:subtitle']
  arrayFields.forEach((key) => {
    // split always returns at least one element
    const cleanKey = key.split(':').pop() as string
    episode[cleanKey] = extractFirstArrayItemString(item, key)
  })

  if (episode.subtitle) {
    episode.subtitle = htmlSanitizer.sanitize(episode.subtitle.trim())
  }

  // Extract psc:chapters if duration is set
  episode.durationSeconds = episode.duration ? timestampToSeconds(episode.duration) : null

  if (item['psc:chapters']?.[0]?.['psc:chapter']?.length && episode.durationSeconds) {
    // Example chapter:
    // {"id":0,"start":0,"end":43.004286,"title":"chapter 1"}

    // psc:chapter was checked above
    const cleanedChapters = (item['psc:chapters'][0]['psc:chapter'] as XmlElement[]).map((chapter, index) => {
      if (!chapter['$']?.title || !chapter['$']?.start || typeof chapter['$']?.start !== 'string' || typeof chapter['$']?.title !== 'string') {
        return null
      }

      // start was checked above
      const start = timestampToSeconds((chapter['$'] as XmlAttributes).start)
      if (start === null) {
        return null
      }

      return {
        id: index,
        // title was checked above
        title: (chapter['$'] as XmlAttributes).title as string,
        start
      }
    })

    if (cleanedChapters.some((chapter) => !chapter)) {
      Logger.warn(`[podcastUtils] Invalid chapter data for ${episode.enclosure.url}`)
    } else {
      // No chapter is null here
      const validChapters = cleanedChapters as { id: number; title: string; start: number }[]
      episode.chapters = validChapters.map((chapter, index) => {
        const nextChapter = validChapters[index + 1]
        // durationSeconds was checked above
        const end = nextChapter ? nextChapter.start : (episode.durationSeconds as number)
        return {
          id: chapter.id,
          title: chapter.title,
          start: chapter.start,
          end
        }
      })
    }
  }

  return episode
}

function cleanEpisodeData(data: RssEpisodeData): RssPodcastEpisode {
  const pubJsDate = data.pubDate ? new Date(data.pubDate) : null
  // isNaN coerces the date to its timestamp
  const publishedAt = pubJsDate && !isNaN(pubJsDate as unknown as number) ? pubJsDate.valueOf() : null

  return {
    title: data.title,
    subtitle: data.subtitle || '',
    description: data.description || '',
    descriptionPlain: data.descriptionPlain || '',
    pubDate: data.pubDate || '',
    episodeType: data.episodeType || '',
    season: data.season || '',
    episode: data.episode || '',
    author: data.author || '',
    duration: data.duration || '',
    durationSeconds: data.durationSeconds || null,
    explicit: data.explicit || '',
    publishedAt,
    enclosure: data.enclosure,
    guid: data.guid || null,
    chaptersUrl: data.chaptersUrl || null,
    chaptersType: data.chaptersType || null,
    chapters: data.chapters || []
  }
}

function extractPodcastEpisodes(items: RssItem[]): RssPodcastEpisode[] {
  const episodes: RssPodcastEpisode[] = []
  items.forEach((item) => {
    const extracted = extractEpisodeData(item)
    if (extracted) {
      episodes.push(cleanEpisodeData(extracted))
    }
  })
  return episodes
}

function cleanPodcastJson(rssJson: RssJson, excludeEpisodeMetadata: boolean): RssPodcast | null {
  if (!rssJson.channel?.length) {
    Logger.error(`[podcastUtil] Invalid podcast no channel object`)
    return null
  }
  const channel = rssJson.channel[0]
  if (!channel.item?.length) {
    Logger.error(`[podcastUtil] Invalid podcast no episodes`)
    return null
  }
  const podcast: RssPodcast = {
    metadata: extractPodcastMetadata(channel)
  }
  if (!excludeEpisodeMetadata) {
    podcast.episodes = extractPodcastEpisodes(channel.item)
  } else {
    podcast.numEpisodes = channel.item.length
  }
  return podcast
}

const parsePodcastRssFeedXml = async (xml: string, excludeEpisodeMetadata = false, includeRaw = false): Promise<{ podcast: RssPodcast; rawJson?: { rss?: RssJson } } | null> => {
  if (!xml) return null
  const json = await xmlToJSON<{ rss?: RssJson }>(xml)
  if (!json?.rss) {
    Logger.error('[podcastUtils] Invalid XML or RSS feed')
    return null
  }

  const podcast = cleanPodcastJson(json.rss, excludeEpisodeMetadata)
  if (!podcast) return null

  if (includeRaw) {
    return {
      podcast,
      rawJson: json
    }
  } else {
    return {
      podcast
    }
  }
}

/**
 * Get podcast RSS feed as JSON
 * Uses SSRF filter to prevent internal URLs
 *
 */
const getPodcastFeed = (feedUrl: string, excludeEpisodeMetadata = false): Promise<RssPodcast | null> => {
  Logger.debug(`[podcastUtils] getPodcastFeed for "${feedUrl}"`)

  let userAgent = 'audiobookshelf (+https://audiobookshelf.org; like iTMS)'
  // Workaround for CBC RSS feeds rejecting our user agent string
  // See: https://github.com/advplyr/audiobookshelf/issues/3322
  if (feedUrl.startsWith('https://www.cbc.ca')) {
    userAgent = 'audiobookshelf (+https://audiobookshelf.org; like iTMS) - CBC'
  }

  return axios({
    url: feedUrl,
    method: 'GET',
    timeout: global.PodcastDownloadTimeout,
    responseType: 'arraybuffer',
    headers: {
      Accept: 'application/rss+xml, application/xhtml+xml, application/xml, */*;q=0.8',
      'Accept-Encoding': 'gzip, compress, deflate',
      'User-Agent': userAgent
    },
    httpAgent: global.DisableSsrfRequestFilter?.(feedUrl) ? null : ssrfFilter(feedUrl),
    httpsAgent: global.DisableSsrfRequestFilter?.(feedUrl) ? null : ssrfFilter(feedUrl)
  })
    .then(async (data) => {
      // Adding support for ios-8859-1 encoded RSS feeds.
      //  See: https://github.com/advplyr/audiobookshelf/issues/1489
      const contentType = data.headers?.['content-type'] || '' // e.g. text/xml; charset=iso-8859-1
      if (contentType.toLowerCase().includes('iso-8859-1')) {
        data.data = data.data.toString('latin1')
      } else {
        data.data = data.data.toString()
      }

      if (!data?.data) {
        Logger.error(`[podcastUtils] getPodcastFeed: Invalid podcast feed request response (${feedUrl})`)
        return null
      }
      Logger.debug(`[podcastUtils] getPodcastFeed for "${feedUrl}" success - parsing xml`)
      const payload = await podcastUtils.parsePodcastRssFeedXml(data.data, excludeEpisodeMetadata)
      if (!payload) {
        return null
      }

      // RSS feed may be a private RSS feed
      payload.podcast.metadata.feedUrl = feedUrl

      return payload.podcast
    })
    .catch((error) => {
      // Check for failures due to redirecting from http to https. If original url was http, upgrade to https and try again
      if (error.code === 'ERR_FR_REDIRECTION_FAILURE' && error.cause.code === 'ERR_INVALID_PROTOCOL') {
        if (feedUrl.startsWith('http://') && error.request._options.protocol === 'https:') {
          Logger.info('Redirection from http to https detected. Upgrading Request', error.request._options.href)
          feedUrl = feedUrl.replace('http://', 'https://')
          return podcastUtils.getPodcastFeed(feedUrl, excludeEpisodeMetadata)
        }
      }
      Logger.error('[podcastUtils] getPodcastFeed Error', error)
      return null
    })
}

// Return array of episodes ordered by closest match using fuse.js
const findMatchingEpisodes = async (feedUrl: string, searchTitle: string) => {
  const feed = await podcastUtils.getPodcastFeed(feedUrl).catch(() => {
    return null
  })

  return podcastUtils.findMatchingEpisodesInFeed(feed, searchTitle)
}

/**
 * @param [threshold=0.4] - 0.0 for perfect match, 1.0 for match anything
 */
const findMatchingEpisodesInFeed = (feed: RssPodcast | null, searchTitle: string, threshold = 0.4): Array<{ episode: RssPodcastEpisode }> | null => {
  if (!feed?.episodes) {
    return null
  }

  const fuseOptions = {
    ignoreDiacritics: true,
    threshold,
    keys: [
      { name: 'title', weight: 0.7 }, // prefer match in title
      { name: 'subtitle', weight: 0.3 }
    ]
  }
  const fuse = new Fuse(feed.episodes, fuseOptions)

  const matches: Array<{ episode: RssPodcastEpisode }> = []
  fuse.search(searchTitle).forEach((match) => {
    matches.push({
      episode: match.item
    })
  })
  return matches
}

const podcastUtils = {
  parsePodcastRssFeedXml,
  getPodcastFeed,
  findMatchingEpisodes,
  findMatchingEpisodesInFeed
}

export = podcastUtils
