import Path = require('path')
import Logger = require('../../Logger')
import StreamZip = require('../../libs/nodeStreamZip')
import parseOpfMetadata = require('./parseOpfMetadata')
import utils = require('../index')
import type { EBookFileObject, EBookFileScanData } from './types'
const { xmlToJSON } = utils

/**
 * xml2js element with attributes (only the fields used)
 */
interface XmlElement {
  $?: Record<string, string>
}

/**
 * META-INF/container.xml as parsed by xml2js (only the fields used)
 */
interface EpubContainerJson {
  container?: {
    rootfiles?: { rootfile?: XmlElement[] }[]
  }
}

/**
 * OPF package document as parsed by xml2js (only the fields used)
 */
interface EpubPackageJson {
  package?: {
    metadata?: { meta?: XmlElement[] } | { meta?: XmlElement[] }[]
    manifest?: { item?: XmlElement[] }[]
  }
}

/**
 * Extract file from epub and return string content
 */
async function extractFileFromEpub(epubPath: string, filepath: string): Promise<string | undefined> {
  const zip = new StreamZip.async({ file: epubPath })
  const data = await zip.entryData(filepath).catch((error) => {
    Logger.error(`[parseEpubMetadata] Failed to extract ${filepath} from epub at "${epubPath}"`, error)
  })
  const filedata = data?.toString('utf8')
  await zip.close().catch((error) => {
    Logger.error(`[parseEpubMetadata] Failed to close zip`, error)
  })

  return filedata
}

/**
 * Extract an XML file from epub and return JSON
 *
 * @template T shape of the parsed xml2js output
 */
async function extractXmlToJson<T>(epubPath: string, xmlFilepath: string): Promise<T | null> {
  const filedata = await extractFileFromEpub(epubPath, xmlFilepath)
  if (!filedata) return null
  return xmlToJSON<T>(filedata)
}

/**
 * Extract cover image from epub return true if success
 */
async function extractCoverImage(epubPath: string, epubImageFilepath: string, outputCoverPath: string): Promise<boolean> {
  const zip = new StreamZip.async({ file: epubPath })

  const success = await zip
    .extract(epubImageFilepath, outputCoverPath)
    .then(() => true)
    .catch((error) => {
      Logger.error(`[parseEpubMetadata] Failed to extract image ${epubImageFilepath} from epub at "${epubPath}"`, error)
      return false
    })

  await zip.close().catch((error) => {
    Logger.error(`[parseEpubMetadata] Failed to close zip`, error)
  })

  return success
}

/**
 * Parse metadata from epub
 */
async function parse(ebookFile: EBookFileObject): Promise<EBookFileScanData | null> {
  const epubPath = ebookFile.metadata.path
  Logger.debug(`Parsing metadata from epub at "${epubPath}"`)
  // Entrypoint of the epub that contains the filepath to the package document (opf file)
  const containerJson = await extractXmlToJson<EpubContainerJson>(epubPath, 'META-INF/container.xml')
  if (!containerJson) {
    return null
  }

  // Get package document opf filepath from container.xml
  const packageDocPath = containerJson.container?.rootfiles?.[0]?.rootfile?.[0]?.$?.['full-path']
  if (!packageDocPath) {
    Logger.error(`Failed to get package doc path in Container.xml`, JSON.stringify(containerJson, null, 2))
    return null
  }

  // Extract package document to JSON
  const packageJson = await extractXmlToJson<EpubPackageJson>(epubPath, packageDocPath)
  if (!packageJson) {
    return null
  }

  // Parse metadata from package document opf file
  // The package document is the OPF package json parseOpfMetadataJson reads
  const opfMetadata = parseOpfMetadata.parseOpfMetadataJson(structuredClone(packageJson) as Parameters<typeof parseOpfMetadata.parseOpfMetadataJson>[0])
  if (!opfMetadata) {
    Logger.error(`Unable to parse metadata in package doc with json`, JSON.stringify(packageJson, null, 2))
    return null
  }

  const payload: EBookFileScanData = {
    path: epubPath,
    ebookFormat: 'epub',
    metadata: opfMetadata
  }

  // Attempt to find filepath to cover image:
  // Metadata may include <meta name="cover" content="id"/> where content is the id of the cover image in the manifest
  //  Otherwise find image in the manifest with cover-image property set
  //  As a fallback the first image in the manifest is used as the cover image
  let packageMetadata = packageJson.package?.metadata
  if (Array.isArray(packageMetadata)) {
    packageMetadata = packageMetadata[0]
  }
  const metaCoverId = packageMetadata?.meta?.find?.((meta) => meta.$?.name === 'cover')?.$?.content

  let manifestFirstImage: XmlElement | null | undefined = null
  if (metaCoverId) {
    manifestFirstImage = packageJson.package?.manifest?.[0]?.item?.find((item) => item.$?.id === metaCoverId)
  }
  if (!manifestFirstImage) {
    manifestFirstImage = packageJson.package?.manifest?.[0]?.item?.find((item) => item.$?.['properties']?.split(' ')?.includes('cover-image'))
  }
  if (!manifestFirstImage) {
    manifestFirstImage = packageJson.package?.manifest?.[0]?.item?.find((item) => item.$?.['media-type']?.startsWith('image/'))
  }

  let coverImagePath = manifestFirstImage?.$?.href
  if (coverImagePath) {
    const packageDirname = Path.dirname(packageDocPath)
    payload.ebookCoverPath = Path.posix.join(packageDirname, coverImagePath)
  } else {
    Logger.warn(`Cover image not found in manifest for epub at "${epubPath}"`)
  }

  return payload
}
export = {
  extractCoverImage,
  parse
}
