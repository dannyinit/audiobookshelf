import fs = require('../libs/fsExtra')
import Logger = require('../Logger')
import Path = require('path')
import Audnexus = require('../providers/Audnexus')

import { downloadImageFile } from '../utils/fileUtils'

class AuthorFinder {
  constructor() {
    this.audnexus = new Audnexus()
  }

  findAuthorByASIN(asin, region) {
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
  async findAuthorByName(name: string, region: string, options: object = {}): Promise<import('../providers/Audnexus').AuthorSearchObj> {
    if (!name) return null
    const maxLevenshtein = !isNaN(options.maxLevenshtein) ? Number(options.maxLevenshtein) : 3

    const author = await this.audnexus.findAuthorByName(name, region, maxLevenshtein)
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
  async saveAuthorImage(authorId: string, url: string): Promise<{ path: string; error: string }> {
    const authorDir = Path.join(global.MetadataPath, 'authors')

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
    }).catch((err) => {
      let errorMsg = err.message || 'Unknown error'
      Logger.error(`[AuthorFinder] Download image file failed for "${url}"`, errorMsg)
      return {
        error: errorMsg
      }
    })
  }
}
export = new AuthorFinder()