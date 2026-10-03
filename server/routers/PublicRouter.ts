import express = require('express')
import ShareController = require('../controllers/ShareController')
import SessionController = require('../controllers/SessionController')
import type PlaybackSessionManager = require('../managers/PlaybackSessionManager')

class PublicRouter {
  declare playbackSessionManager: PlaybackSessionManager
  declare router: express.Express

  constructor(playbackSessionManager: PlaybackSessionManager) {
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
