import sanitizeHtml = require('../libs/sanitizeHtml')
import { entities } from './htmlEntities'

/**
 *
 * @param {string} html
 * @returns {string}
 */
function sanitize(html: unknown): string {
  if (typeof html !== 'string') {
    return ''
  }

  const sanitizerOptions = {
    allowedTags: ['p', 'ol', 'ul', 'li', 'a', 'strong', 'em', 'del', 'br', 'b', 'i'],
    disallowedTagsMode: 'discard',
    allowedAttributes: {
      a: ['href', 'name', 'target']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false
  }

  return sanitizeHtml(html, sanitizerOptions)
}
export { sanitize }

function stripAllTags(html: unknown, shouldDecodeEntities = true): string {
  if (typeof html !== 'string') return ''

  const sanitizerOptions = {
    allowedTags: [],
    disallowedTagsMode: 'discard'
  }

  let sanitized = sanitizeHtml(html, sanitizerOptions)
  return shouldDecodeEntities ? decodeHTMLEntities(sanitized) : sanitized
}
export { stripAllTags }

function decodeHTMLEntities(strToDecode: string): string {
  return strToDecode.replace(/\&([^;]+);?/g, function (entity) {
    if (entity in entities) {
      return entities[entity as keyof typeof entities]
    }
    return entity
  })
}
