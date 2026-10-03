import xml = require('../../libs/xml')
import escapeForXML = require('../../libs/xml/escapeForXML')
import Podcast = require('../../models/Podcast')

/**
 * Generate OPML file string for podcasts in a library
 */
const generate = (podcasts: Podcast[], indent = true): string => {
  const bodyItems: { outline: { _attr: Record<string, string> } }[] = []
  podcasts.forEach((podcast) => {
    if (!podcast.feedURL) return
    const feedAttributes: Record<string, string> = {
      type: 'rss',
      text: escapeForXML(podcast.title),
      title: escapeForXML(podcast.title),
      xmlUrl: escapeForXML(podcast.feedURL)
    }
    if (podcast.description) {
      feedAttributes.description = escapeForXML(podcast.description)
    }
    // NOTE: the Podcast model field is itunesPageURL, so itunesPageUrl is always undefined and htmlUrl is never set
    // Podcast has no itunesPageUrl property; widened so the existing (always undefined) read compiles
    const podcastWithPageUrl = podcast as Podcast & { itunesPageUrl?: string }
    if (podcastWithPageUrl.itunesPageUrl) {
      feedAttributes.htmlUrl = escapeForXML(podcastWithPageUrl.itunesPageUrl)
    }
    if (podcast.language) {
      feedAttributes.language = escapeForXML(podcast.language)
    }
    bodyItems.push({
      outline: {
        _attr: feedAttributes
      }
    })
  })

  const data = [
    {
      opml: [
        {
          _attr: {
            version: '1.0'
          }
        },
        {
          head: [
            {
              title: 'Audiobookshelf Podcast Subscriptions'
            }
          ]
        },
        {
          body: bodyItems
        }
      ]
    }
  ]

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml(data, indent)
}
export = { generate }
