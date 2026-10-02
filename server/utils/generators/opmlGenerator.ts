import xml = require('../../libs/xml')
import escapeForXML = require('../../libs/xml/escapeForXML')

/**
 * Generate OPML file string for podcasts in a library
 * @param {import('../../models/Podcast')[]} podcasts 
 * @param {boolean} [indent=true] 
 * @returns {string}
 */
export const generate = (podcasts: import('../../models/Podcast')[], indent = true) => {
  const bodyItems: Record<string, any>[] = []
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
    // NOTE: the Podcast attribute is itunesPageURL, so this is always undefined (kept as-is)
    const itunesPageUrl = (podcast as { itunesPageUrl?: string }).itunesPageUrl
    if (itunesPageUrl) {
      feedAttributes.htmlUrl = escapeForXML(itunesPageUrl)
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