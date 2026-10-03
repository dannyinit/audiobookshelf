import fs = require('../libs/fsExtra')
import Logger = require('../Logger')
import Path = require('path')
import Audnexus = require('../providers/Audnexus')

import fileUtils = require('../utils/fileUtils')

const { downloadImageFile } = fileUtils

/**
 * Globals set at server startup (see server/Server.js)
 */
type ServerGlobals = typeof globalThis & { MetadataPath: string }

class AuthorFinder {
  audnexus: Audnexus

  constructor() {
    this.audnexus = new Audnexus()
  }

  findAuthorByASIN(asin: string, region?: string): Promise<Audnexus.AuthorSearchObj | null> | null {
    if (!asin) return null
    return this.audnexus.findAuthorByASIN(asin, region)
  }

  async findAuthorByName(name: string, region?: string, options: { maxLevenshtein?: number } = {}): Promise<Audnexus.AuthorSearchObj | null> {
    if (!name) return null
    const maxLevenshtein = !isNaN(Number(options.maxLevenshtein)) ? Number(options.maxLevenshtein) : 3

    const author = await this.audnexus.findAuthorByName(name, region, maxLevenshtein)
    if (!author?.name) {
      return null
    }
    return author
  }

  /**
   * Download author image from url and save in authors folder
   */
  async saveAuthorImage(authorId: string, url: string): Promise<{ path: string } | { error: string }> {
    const authorDir = Path.join((global as ServerGlobals).MetadataPath, 'authors')

    if (!await fs.pathExists(authorDir)) {
      await fs.ensureDir(authorDir)
    }

    const imageExtension = url.toLowerCase().split('.').pop()
    const ext = imageExtension === 'png' ? 'png' : 'jpg'
    const filename = authorId + '.' + ext
    const outputPath = Path.posix.join(authorDir, filename)

    return downloadImageFile(url, outputPath).then(() => {
      return {
        path: outputPath
      }
    }).catch((err: Error) => {
      let errorMsg = err.message || 'Unknown error'
      Logger.error(`[AuthorFinder] Download image file failed for "${url}"`, errorMsg)
      return {
        error: errorMsg
      }
    })
  }
}
export = new AuthorFinder()
