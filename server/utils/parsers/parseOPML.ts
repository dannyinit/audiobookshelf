import * as h from 'htmlparser2'
import Logger = require('../../Logger')

function parse(opmlText: string): Array<{ title: string; feedUrl: string }> {
  var feeds: Array<{ title: string; feedUrl: string }> = []
  var parser = new h.Parser({
    onopentag: (name, attribs) => {
      if (name === 'outline' && attribs.type === 'rss') {
        if (!attribs.xmlurl) {
          Logger.error('[parseOPML] Invalid opml outline tag has no xmlurl attribute')
        } else {
          feeds.push({
            title: attribs.title || attribs.text || '',
            feedUrl: attribs.xmlurl
          })
        }
      }
    }
  })
  parser.write(opmlText)
  return feeds
}
export = { parse }
