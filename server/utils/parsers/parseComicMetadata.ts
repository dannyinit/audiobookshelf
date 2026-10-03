import Path = require('path')
import Logger = require('../../Logger')
import parseComicInfoMetadata = require('./parseComicInfoMetadata')
import globals = require('../globals')
import utils = require('../index')
import comicBookExtractors = require('../comicBookExtractors')
import type { EBookFileObject, EBookFileScanData } from './types'
const { xmlToJSON } = utils
const { createComicBookExtractor } = comicBookExtractors

type ComicBookExtractor = ReturnType<typeof createComicBookExtractor>

/**
 * Extract cover image from comic return true if success
 */
async function extractCoverImage(comicPath: string, comicImageFilepath: string, outputCoverPath: string): Promise<boolean> {
  let archive: ComicBookExtractor | null = null
  try {
    archive = createComicBookExtractor(comicPath)
    await archive.open()
    return await archive.extractToFile(comicImageFilepath, outputCoverPath)
  } catch (error) {
    Logger.error(`[parseComicMetadata] Failed to extract image "${comicImageFilepath}" from comicPath "${comicPath}" into "${outputCoverPath}"`, error)
    return false
  } finally {
    // Ensure we free the memory
    archive?.close()
  }
}

/**
 * Parse metadata from comic
 */
async function parse(ebookFile: EBookFileObject): Promise<EBookFileScanData | null> {
  const comicPath = ebookFile.metadata.path
  Logger.debug(`[parseComicMetadata] Parsing comic metadata at "${comicPath}"`)
  let archive: ComicBookExtractor | null = null
  try {
    archive = createComicBookExtractor(comicPath)
    await archive.open()

    const filePaths = await archive.getFilePaths().catch((error) => {
      Logger.error(`[parseComicMetadata] Failed to get file paths from comic at "${comicPath}"`, error)
    })

    // filePaths is undefined when getFilePaths fails; sort then throws and the catch below returns null, as in the JS
    const comicFilePaths = filePaths as string[]

    // Sort the file paths in a natural order to get the first image
    comicFilePaths.sort((a, b) => {
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    })

    let metadata: ReturnType<typeof parseComicInfoMetadata.parse> = null
    const comicInfoPath = comicFilePaths.find((filePath) => filePath === 'ComicInfo.xml')
    if (comicInfoPath) {
      const comicInfoData = await archive.extractToBuffer(comicInfoPath)
      if (comicInfoData) {
        const comicInfoStr = new TextDecoder().decode(comicInfoData)
        const comicInfoJson = await xmlToJSON<Parameters<typeof parseComicInfoMetadata.parse>[0]>(comicInfoStr)
        if (comicInfoJson) {
          metadata = parseComicInfoMetadata.parse(comicInfoJson)
        }
      }
    }

    const payload: EBookFileScanData = {
      path: comicPath,
      ebookFormat: ebookFile.ebookFormat,
      metadata
    }

    const firstImagePath = comicFilePaths.find((filePath) => globals.SupportedImageTypes.includes(Path.extname(filePath).toLowerCase().slice(1)))
    if (firstImagePath) {
      payload.ebookCoverPath = firstImagePath
    } else {
      Logger.warn(`[parseComicMetadata] Cover image not found in comic at "${comicPath}"`)
    }

    return payload
  } catch (error) {
    Logger.error(`[parseComicMetadata] Failed to parse comic metadata at "${comicPath}"`, error)
    return null
  } finally {
    // Ensure we free the memory
    archive?.close()
  }
}
export = {
  extractCoverImage,
  parse
}
