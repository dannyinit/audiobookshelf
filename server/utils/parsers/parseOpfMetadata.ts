import utils = require('../index')
import htmlSanitizer = require('../htmlSanitizer')
const { xmlToJSON } = utils

/**
 * xml2js element that has attributes: `_` is the text content and `$` the attributes
 */
interface XmlElement {
  _?: string
  $?: Record<string, string>
}

/**
 * xml2js child elements keyed by tag name. Each value is an array of strings or XmlElements
 */
type XmlTagMap = { [tag: string]: unknown }

interface OpfRefine {
  value: string | undefined
  refines: string
  property: string
}

/**
 * The <meta> elements of the OPF metadata after they are grouped by name in parseOpfMetadataJson
 */
interface OpfMeta {
  [name: string]: string[] | OpfRefine[] | undefined
  refines?: OpfRefine[]
}

interface OpfMetadata {
  meta: OpfMeta
  [tag: string]: unknown
}

interface MetadataCreatorObject {
  value: string
  role: string | null
  fileAs: string | null
}

/**
 * @example
 * <dc:creator xmlns:ns0="http://www.idpf.org/2007/opf" ns0:role="aut" ns0:file-as="Steinbeck, John">John Steinbeck</dc:creator>
 * <dc:creator opf:role="aut" opf:file-as="Orwell, George">George Orwell</dc:creator>
 */
function parseCreators(metadata: OpfMetadata): (MetadataCreatorObject | false)[] | null {
  // cast(a): xml2js output is untyped; it puts child elements in arrays
  const dcCreators = metadata['dc:creator'] as (string | XmlElement)[] | undefined
  if (!dcCreators?.length) return null
  return dcCreators.map((c) => {
    if (typeof c !== 'object' || !c['$'] || !c['_']) return false
    const namespace =
      Object.keys(c['$'])
        .find((key) => key.startsWith('xmlns:'))
        ?.split(':')[1] || 'opf'
    const attributes = c['$']
    const creator: MetadataCreatorObject = {
      value: c['_'],
      role: attributes[`${namespace}:role`] || null,
      fileAs: attributes[`${namespace}:file-as`] || null
    }

    const id = attributes['id']
    if (id && metadata.meta.refines?.some((r) => r.refines === `#${id}`)) {
      const creatorMeta = metadata.meta.refines.filter((r) => r.refines === `#${id}`)
      if (creatorMeta) {
        creator.role = creatorMeta.find((r) => r.property === 'role')?.value || creator.role || null
        creator.fileAs = creatorMeta.find((r) => r.property === 'file-as')?.value || creator.fileAs || null
      }
    }

    return creator
  })
}

function fetchCreators(creators: (MetadataCreatorObject | false)[] | null, role: string): string[] | null {
  if (!creators?.length) return null
  // cast(d): false entries read undefined properties here and are filtered out, as in the JS
  const creatorObjects = creators as MetadataCreatorObject[]
  return [...new Set(creatorObjects.filter((c) => c.role === role && c.value).map((c) => c.value))]
}

function fetchTagString(metadata: XmlTagMap, tag: string): string | null {
  // cast(a): xml2js output is untyped; it puts child elements in arrays
  const tagValues = metadata[tag] as (string | XmlElement)[] | undefined
  if (!tagValues || !tagValues.length) return null
  let value: string | XmlElement | undefined = tagValues[0]

  /*
    EXAMPLES:

    "dc:title": [
      {
        "_": "The Quest for Character",
        "$": {
          "opf:file-as": "Quest for Character What the Story of Socrates and Alcibiades"
        }
      }
    ]

    OR

    "dc:title": [
      "The Quest for Character"
    ]
  */
  if (typeof value === 'object') value = value._
  if (typeof value !== 'string') return null
  return value
}

function fetchDate(metadata: XmlTagMap): string | null {
  const date = fetchTagString(metadata, 'dc:date')
  if (!date) return null
  const dateSplit = date.split('-')
  // cast(d): isNaN coerces the string, as in the JS
  if (!dateSplit.length || dateSplit[0].length !== 4 || isNaN(dateSplit[0] as unknown as number)) return null
  return dateSplit[0]
}

function fetchPublisher(metadata: XmlTagMap): string | null {
  return fetchTagString(metadata, 'dc:publisher')
}

/**
 * @example
 * <dc:identifier xmlns:ns4="http://www.idpf.org/2007/opf" ns4:scheme="ISBN">9781440633904</dc:identifier>
 * <dc:identifier opf:scheme="ISBN">9780141187761</dc:identifier>
 */
function fetchIdentifier(metadata: XmlTagMap, scheme: string): string | null {
  // cast(a): xml2js output is untyped; it puts child elements in arrays, identifiers with a scheme attribute are elements
  const identifiers = metadata['dc:identifier'] as XmlElement[] | undefined
  if (!identifiers?.length) return null
  const identifierObj = identifiers.find((i) => {
    if (!i['$']) return false
    const namespace =
      Object.keys(i['$'])
        .find((key) => key.startsWith('xmlns:'))
        ?.split(':')[1] || 'opf'
    // cast(d): i['$'] was checked above (the cast changes no type)
    return (i['$'] as Record<string, string>)[`${namespace}:scheme`] === scheme
  })
  return identifierObj?.['_'] || null
}

function fetchISBN(metadata: XmlTagMap): string | null {
  return fetchIdentifier(metadata, 'ISBN')
}

function fetchASIN(metadata: XmlTagMap): string | null {
  return fetchIdentifier(metadata, 'ASIN')
}

function fetchTitle(metadata: XmlTagMap): string | null {
  return fetchTagString(metadata, 'dc:title')
}

function fetchSubtitle(metadata: XmlTagMap): string | null {
  return fetchTagString(metadata, 'dc:subtitle')
}

function fetchDescription(metadata: XmlTagMap): string | null {
  let description = fetchTagString(metadata, 'dc:description')
  if (!description) return null
  // check if description is HTML or plain text. only plain text allowed
  // calibre stores < and > as &lt; and &gt;
  description = description.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return htmlSanitizer.stripAllTags(description)
}

function fetchGenres(metadata: XmlTagMap): string[] {
  // cast(a): xml2js output is untyped; it puts child elements in arrays
  const subjects = metadata['dc:subject'] as unknown[] | undefined
  if (!subjects || !subjects.length) return []
  return [...new Set(subjects.filter((g): g is string => !!(g && typeof g === 'string')))]
}

function fetchLanguage(metadata: XmlTagMap): string | null {
  return fetchTagString(metadata, 'dc:language')
}

function fetchSeries(metadataMeta: XmlElement[] | undefined): { name: string; sequence: string | null }[] {
  if (!metadataMeta) return []
  const result: { name: string; sequence: string | null }[] = []
  for (let i = 0; i < metadataMeta.length; i++) {
    const meta = metadataMeta[i]
    const nextMeta = metadataMeta[i + 1]
    if (meta.$?.name === 'calibre:series' && meta.$.content?.trim()) {
      const name = meta.$.content.trim()
      let sequence: string | null = null
      if (nextMeta?.$?.name === 'calibre:series_index' && nextMeta.$?.content?.trim()) {
        sequence = nextMeta.$.content.trim()
      }
      result.push({ name, sequence })
    }
  }

  // If one series was found with no series_index then check if any series_index meta can be found
  //   this is to support when calibre:series_index is not directly underneath calibre:series
  if (result.length === 1 && !result[0].sequence) {
    const seriesIndexMeta = metadataMeta.find((m) => m.$?.name === 'calibre:series_index' && m.$.content?.trim())
    if (seriesIndexMeta) {
      // cast(d): find() above only matches metas with $ set
      result[0].sequence = (seriesIndexMeta.$ as Record<string, string>).content.trim()
    }
  }

  // Remove duplicates
  const dedupedResult = result.filter((se, idx) => result.findIndex((s) => s.name === se.name) === idx)

  return dedupedResult
}

function fetchNarrators(creators: (MetadataCreatorObject | false)[] | null, metadata: OpfMetadata): string[] | null {
  const narrators = fetchCreators(creators, 'nrt')
  if (narrators?.length) return narrators
  try {
    // cast(d): a null tag string throws here and is caught below, as in the JS
    const narratorsJSON = JSON.parse((fetchTagString(metadata.meta, 'calibre:user_metadata:#narrators') as string).replace(/&quot;/g, '"'))
    return narratorsJSON['#value#']
  } catch {
    return null
  }
}

function fetchTags(metadata: XmlTagMap): string[] {
  // cast(a): xml2js output is untyped; it puts child elements in arrays
  const tags = metadata['dc:tag'] as unknown[] | undefined
  if (!tags || !tags.length) return []
  return [...new Set(tags.filter((tag): tag is string => !!(tag && typeof tag === 'string')))]
}

function stripPrefix(str: string): string | undefined {
  if (!str) return ''
  return str.split(':').pop()
}

/**
 * OPF package document as parsed by xml2js, keyed by the (optionally prefixed) package element name
 */
type OpfPackageJson = Record<string, Record<string, unknown>>

const parseOpfMetadataJson = (json: OpfPackageJson) => {
  // Handle <package ...> or with prefix <ns0:package ...>
  const packageKey = Object.keys(json).find((key) => stripPrefix(key) === 'package')
  if (!packageKey) return null
  const prefix = packageKey.split(':').shift()
  // cast(a): xml2js output is untyped; this is the <metadata> element of the OPF package
  let metadata = (prefix ? json[packageKey][`${prefix}:metadata`] || json[packageKey].metadata : json[packageKey].metadata) as OpfMetadata | OpfMetadata[] | undefined
  if (!metadata) return null
  if (Array.isArray(metadata)) {
    if (!metadata.length) return null
    metadata = metadata[0]
  }

  // cast(a): xml2js output is untyped; before it is replaced below, meta holds the raw <meta> elements
  const metadataMeta = (prefix ? metadata[`${prefix}:meta`] || metadata.meta : metadata.meta) as unknown as XmlElement[] | undefined

  const opfMetadata = metadata
  opfMetadata.meta = {}
  if (metadataMeta?.length) {
    metadataMeta.forEach((meta) => {
      if (meta?.['$']?.name) {
        opfMetadata.meta[meta['$'].name] = [meta['$'].content || '']
      } else if (meta?.['$']?.refines) {
        // https://www.w3.org/TR/epub-33/#sec-meta-elem

        if (!opfMetadata.meta.refines) {
          opfMetadata.meta.refines = []
        }
        opfMetadata.meta.refines.push({
          value: meta._,
          refines: meta['$'].refines,
          property: meta['$'].property
        })
      }
    })
  }
  const creators = parseCreators(metadata)
  const authors = (fetchCreators(creators, 'aut') || []).map((au) => au?.trim()).filter((au) => au)
  const narrators = (fetchNarrators(creators, metadata) || []).map((nrt) => nrt?.trim()).filter((nrt) => nrt)
  return {
    title: fetchTitle(metadata),
    subtitle: fetchSubtitle(metadata),
    authors,
    narrators,
    publishedYear: fetchDate(metadata),
    publisher: fetchPublisher(metadata),
    isbn: fetchISBN(metadata),
    asin: fetchASIN(metadata),
    description: fetchDescription(metadata),
    genres: fetchGenres(metadata),
    language: fetchLanguage(metadata),
    series: fetchSeries(metadataMeta),
    tags: fetchTags(metadata)
  }
}

const parseOpfMetadataXML = async (xml: string) => {
  const json = await xmlToJSON<OpfPackageJson>(xml)
  if (!json) return null

  return parseOpfMetadata.parseOpfMetadataJson(json)
}

const parseOpfMetadata = {
  parseOpfMetadataJson,
  parseOpfMetadataXML
}

export = parseOpfMetadata
