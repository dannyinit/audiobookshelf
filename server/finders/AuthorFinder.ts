import fs = require('../libs/fsExtra')
import Logger = require('../Logger')
import Path = require('path')
import Audnexus = require('../providers/Audnexus')

import fileUtils = require('../utils/fileUtils')
const { downloadImageFile } = fileUtils

type AuthorSearchObj = import('../providers/Audnexus').AuthorSearchObj

/** `global.MetadataPath` is assigned at server startup */
type ServerGlobal = typeof globalThis & { MetadataPath: string }

interface FindAuthorByNameOptions {
  /** May arrive as a query string value */
  maxLevenshtein?: number | string
}

type SaveAuthorImageResult = { path: string } | { error: string }

class AuthorFinder {
  audnexus: Audnexus

  constructor() {
    this.audnexus = new Audnexus()
  }

  findAuthorByASIN(asin: string, region: string): Promise<AuthorSearchObj> | null {
    if (!asin) return null
    return this.audnexus.findAuthorByASIN(asin, region)
  }

  /**
   *
   * @param {string} name
   * @param {string} region
   * @param {Object} [options={}]
   * @returns {Promise<import('../providers/Audnexus').AuthorSearchObj>}
   */
  async findAuthorByName(name: string, region?: string, options: FindAuthorByNameOptions = {}): Promise<AuthorSearchObj | null> {
    if (!name) return null
    const maxLevenshtein = !isNaN(Number(options.maxLevenshtein)) ? Number(options.maxLevenshtein) : 3

    const author = await this.audnexus.findAuthorByName(name, region as string, maxLevenshtein)
    if (!author?.name) {
      return null
    }
    return author
  }

  /**
   * Download author image from url and save in authors folder
   *
   * @param {string} authorId
   * @param {string} url
   * @returns {Promise<{path:string, error:string}>}
   */
  async saveAuthorImage(authorId: string, url: string): Promise<SaveAuthorImageResult> {
    const authorDir = Path.join((global as ServerGlobal).MetadataPath, 'authors')

    if (!(await fs.pathExists(authorDir))) {
      await fs.ensureDir(authorDir)
    }

    const imageExtension = url.toLowerCase().split('.').pop()
    const ext = imageExtension === 'png' ? 'png' : 'jpg'
    const filename = authorId + '.' + ext
    const outputPath = Path.posix.join(authorDir, filename)

    return downloadImageFile(url, outputPath)
      .then((): SaveAuthorImageResult => {
        return {
          path: outputPath
        }
      })
      .catch((err: { message?: string }): SaveAuthorImageResult => {
        let errorMsg = err.message || 'Unknown error'
        Logger.error(`[AuthorFinder] Download image file failed for "${url}"`, errorMsg)
        return {
          error: errorMsg
        }
      })
  }
}
export = new AuthorFinder()
