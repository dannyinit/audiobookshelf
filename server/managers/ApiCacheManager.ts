import lruCache = require('lru-cache')
import Logger = require('../Logger')
import Database = require('../Database')
import type { Request, Response, NextFunction } from 'express'
import type { SequelizeHooks } from 'sequelize/types/hooks'
const { LRUCache } = lruCache

/**
 * Response stored in the cache
 */
interface CachedResponse {
  body: string
  headers: ReturnType<Response['getHeaders']>
  statusCode: number
}

/**
 * What a sequelize hook passes as its first argument: a model instance, an array of instances or the options of a
 * bulk operation (which have the model class)
 */
interface HookTarget {
  name?: unknown
  model?: { name?: unknown }
  constructor?: { name?: unknown }
}

/**
 * Response with the original send kept while res.send is replaced by the caching one
 */
type CachingResponse = Response & { originalSend?: Response['send'] }

class ApiCacheManager {
  defaultCacheOptions = { max: 1000, maxSize: 10 * 1000 * 1000, sizeCalculation: (item: CachedResponse) => item.body.length + JSON.stringify(item.headers).length }
  defaultTtlOptions = { ttl: 30 * 60 * 1000 }
  highChurnModels = new Set(['session', 'mediaProgress', 'playbackSession', 'device'])
  modelsInvalidatingPersonalized = new Set(['mediaProgress'])
  modelsInvalidatingMe = new Set(['session', 'mediaProgress', 'playbackSession', 'device'])

  declare cache: lruCache.LRUCache<string, CachedResponse>
  declare ttlOptions: { ttl: number }

  constructor(cache = new LRUCache<string, CachedResponse>(this.defaultCacheOptions), ttlOptions = this.defaultTtlOptions) {
    this.cache = cache
    this.ttlOptions = ttlOptions
  }

  init(database = Database) {
    let hooks: (keyof SequelizeHooks)[] = ['afterCreate', 'afterUpdate', 'afterDestroy', 'afterBulkCreate', 'afterBulkUpdate', 'afterBulkDestroy', 'afterUpsert']
    hooks.forEach((hook) => database.sequelize.addHook(hook, (model: HookTarget) => this.clear(model, hook)))
  }

  getModelName(model: HookTarget | null | undefined) {
    if (typeof model?.name === 'string') return model.name
    if (typeof model?.model?.name === 'string') return model.model.name
    if (typeof model?.constructor?.name === 'string' && model.constructor.name !== 'Object') return model.constructor.name
    return 'unknown'
  }

  clearByUrlPattern(urlPattern: RegExp) {
    let removed = 0
    for (const key of this.cache.keys()) {
      try {
        const parsed = JSON.parse(key)
        if (typeof parsed?.url === 'string' && urlPattern.test(parsed.url)) {
          if (this.cache.delete(key)) removed++
        }
      } catch {
        if (this.cache.delete(key)) removed++
      }
    }
    return removed
  }

  clearUserProgressSlices(modelName: string, hook: string) {
    let removedPersonalized = 0
    let removedRecentEpisodes = 0
    if (this.modelsInvalidatingPersonalized.has(modelName)) {
      removedPersonalized = this.clearByUrlPattern(/^\/libraries\/[^/]+\/personalized/)
      removedRecentEpisodes = this.clearByUrlPattern(/^\/libraries\/[^/]+\/recent-episodes/)
    }
    const removedMe = this.modelsInvalidatingMe.has(modelName) ? this.clearByUrlPattern(/^\/me(\/|\?|$)/) : 0
    Logger.debug(`[ApiCacheManager] ${modelName}.${hook}: cleared user-progress cache slices (personalized=${removedPersonalized}, recentEpisodes=${removedRecentEpisodes}, me=${removedMe})`)
  }

  clear(model: HookTarget | null | undefined, hook: string) {
    const modelName = this.getModelName(model)
    if (this.highChurnModels.has(modelName)) {
      this.clearUserProgressSlices(modelName, hook)
      return
    }

    Logger.debug(`[ApiCacheManager] ${modelName}.${hook}: Clearing cache`)
    this.cache.clear()
  }

  /**
   * Reset hooks and clear cache. Used when applying backups
   */
  reset() {
    Logger.info(`[ApiCacheManager] Resetting cache`)

    this.init()
    this.cache.clear()
  }

  get middleware() {
    return (req: Request, res: CachingResponse, next: NextFunction) => {
      if (req.query.sort === 'random') {
        Logger.debug(`[ApiCacheManager] Skipping cache for random sort`)
        return next()
      }

      // cast(d): the cached routes are behind the auth middleware, which sets req.user
      const key = { user: req.user!.username, url: req.url }
      const stringifiedKey = JSON.stringify(key)
      Logger.debug(`[ApiCacheManager] count: ${this.cache.size} size: ${this.cache.calculatedSize}`)
      const cached = this.cache.get(stringifiedKey)
      if (cached) {
        Logger.debug(`[ApiCacheManager] Cache hit: ${stringifiedKey}`)
        res.set(cached.headers)
        res.status(cached.statusCode)
        res.send(cached.body)
        return
      }
      res.originalSend = res.send
      // cast(b): express types send as returning the response; the caching send returns nothing, as in the JS
      res.send = ((body: string) => {
        Logger.debug(`[ApiCacheManager] Cache miss: ${stringifiedKey}`)
        const cached = { body, headers: res.getHeaders(), statusCode: res.statusCode }
        if (key.url.search(/^\/libraries\/.*?\/personalized/) !== -1) {
          Logger.debug(`[ApiCacheManager] Caching with ${this.ttlOptions.ttl} ms TTL`)
          this.cache.set(stringifiedKey, cached, this.ttlOptions)
        } else {
          this.cache.set(stringifiedKey, cached)
        }
        // cast(d): set just above, before send is replaced
        res.originalSend!(body)
      }) as Response['send']
      next()
    }
  }
}
export = ApiCacheManager
