import express = require('express')
import ShareController = require('../controllers/ShareController')
import SessionController = require('../controllers/SessionController')

class PublicRouter {
  /** @type {import('../managers/PlaybackSessionManager')} */
  playbackSessionManager

  constructor(playbackSessionManager) {
    this.playbackSessionManager = playbackSessionManager

    this.router = express()
    this.router.disable('x-powered-by')
    this.init()
  }

  init() {
    this.router.get('/share/:slug', ShareController.getMediaItemShareBySlug.bind(this))
    this.router.get('/share/:slug/track/:index', ShareController.getMediaItemShareAudioTrack.bind(this))
    this.router.get('/share/:slug/cover', ShareController.getMediaItemShareCoverImage.bind(this))
    this.router.get('/share/:slug/download', ShareController.downloadMediaItemShare.bind(this))
    this.router.patch('/share/:slug/progress', ShareController.updateMediaItemShareProgress.bind(this))
    this.router.get('/session/:id/track/:index', SessionController.getTrack.bind(this))
  }
}
export = PublicRouter
