import { rateLimit } from 'express-rate-limit'
import type { RequestHandler } from 'express'
import Logger = require('../Logger')
import requestIp = require('../libs/requestIp')

/**
 * Factory for creating authentication rate limiters
 */
class RateLimiterFactory {
  static DEFAULT_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
  static DEFAULT_MAX = 40 // 40 attempts

  authRateLimiter: RequestHandler | null

  constructor() {
    this.authRateLimiter = null
  }

  /**
   * Get the authentication rate limiter
   */
  getAuthRateLimiter(): RequestHandler {
    if (this.authRateLimiter) {
      return this.authRateLimiter
    }

    // Disable by setting max to 0
    if (process.env.RATE_LIMIT_AUTH_MAX === '0') {
      this.authRateLimiter = (req, res, next) => next()
      Logger.info(`[RateLimiterFactory] Authentication rate limiting disabled by ENV variable`)
      return this.authRateLimiter
    }

    let windowMs = RateLimiterFactory.DEFAULT_WINDOW_MS
    // parseInt(undefined) is NaN, which fails the check
    if (parseInt(process.env.RATE_LIMIT_AUTH_WINDOW as string) > 0) {
      // Set when the check above passes
      windowMs = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW as string)
      if (windowMs !== RateLimiterFactory.DEFAULT_WINDOW_MS) {
        Logger.info(`[RateLimiterFactory] Authentication rate limiting window set to ${windowMs}ms by ENV variable`)
      }
    }

    let max = RateLimiterFactory.DEFAULT_MAX
    // parseInt(undefined) is NaN, which fails the check
    if (parseInt(process.env.RATE_LIMIT_AUTH_MAX as string) > 0) {
      // Set when the check above passes
      max = parseInt(process.env.RATE_LIMIT_AUTH_MAX as string)
      if (max !== RateLimiterFactory.DEFAULT_MAX) {
        Logger.info(`[RateLimiterFactory] Authentication rate limiting max set to ${max} by ENV variable`)
      }
    }

    let message = 'Too many authentication requests'
    if (process.env.RATE_LIMIT_AUTH_MESSAGE) {
      message = process.env.RATE_LIMIT_AUTH_MESSAGE
    }

    this.authRateLimiter = rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        // Override keyGenerator to handle proxy IPs
        // req.ip is set by express for socket requests
        return (requestIp.getClientIp(req) || req.ip) as string
      },
      handler: (req, res) => {
        const userAgent = req.get('User-Agent') || 'Unknown'
        const endpoint = req.path
        const method = req.method
        const ip = requestIp.getClientIp(req) || req.ip

        Logger.warn(`[RateLimiter] Rate limit exceeded - IP: ${ip}, Endpoint: ${method} ${endpoint}, User-Agent: ${userAgent}`)

        res.status(429).json({
          error: message
        })
      }
    })

    Logger.debug(`[RateLimiterFactory] Created auth rate limiter: ${max} attempts per ${windowMs / 1000 / 60} minutes`)

    return this.authRateLimiter
  }
}

export = new RateLimiterFactory()
