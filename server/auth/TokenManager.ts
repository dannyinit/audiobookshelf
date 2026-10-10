import sequelize = require('sequelize')
import uuid = require('uuid')

import Database = require('../Database')
import Logger = require('../Logger')

import requestIp = require('../libs/requestIp')
import jwt = require('../libs/jsonwebtoken')
import requestUtils = require('../utils/requestUtils')
import type { Request, Response } from 'express'
import type Session = require('../models/Session')
import type User = require('../models/User')
import type { JwtPayload, PassportDone } from './types'
const { Op } = sequelize
const { isRequestSecure } = requestUtils

/**
 * Session row with the refresh token columns (the JS Session model does not declare refreshToken)
 */
type SessionRow = Omit<Session, 'lastRefreshToken' | 'lastRefreshTokenExpiresAt'> & {
  refreshToken: string | null
  lastRefreshToken: string | null
  lastRefreshTokenExpiresAt: Date | null
}

/**
 * User with the temporary isOldToken flag set by jwtAuthCheck
 */
type UserWithOldTokenFlag = User & { isOldToken?: boolean }

class TokenManager {
  /** JWT secret key */
  static TokenSecret: string | null = null

  /** Refresh token expiry in seconds */
  declare RefreshTokenExpiry: number
  /** Access token expiry in seconds */
  declare AccessTokenExpiry: number
  /** Grace period in seconds during which a rotated (old) refresh token is still accepted */
  declare RefreshTokenGracePeriod: number

  constructor() {
    // cast(d): the variable may be unset; parseInt(undefined) is NaN, so the fallback is used, like the JS
    this.RefreshTokenExpiry = parseInt(process.env.REFRESH_TOKEN_EXPIRY as string) || 30 * 24 * 60 * 60 // 30 days
    // cast(d): the variable may be unset; parseInt(undefined) is NaN, so the fallback is used, like the JS
    this.AccessTokenExpiry = parseInt(process.env.ACCESS_TOKEN_EXPIRY as string) || 1 * 60 * 60 // 1 hour
    // cast(d): the variable may be unset; parseInt(undefined) is NaN, so the fallback is used, like the JS
    this.RefreshTokenGracePeriod = parseInt(process.env.REFRESH_TOKEN_GRACE_PERIOD as string) || 10 * 60 // 10 minutes

    // cast(d): the variable may be unset; parseInt(undefined) is NaN, which fails the check
    if (parseInt(process.env.REFRESH_TOKEN_EXPIRY as string) > 0) { // parseInt(undefined) is NaN
      Logger.info(`[TokenManager] Refresh token expiry set from ENV variable to ${this.RefreshTokenExpiry} seconds`)
    }
    // cast(d): the variable may be unset; parseInt(undefined) is NaN, which fails the check
    if (parseInt(process.env.ACCESS_TOKEN_EXPIRY as string) > 0) { // parseInt(undefined) is NaN
      Logger.info(`[TokenManager] Access token expiry set from ENV variable to ${this.AccessTokenExpiry} seconds`)
    }
    // cast(d): the variable may be unset; parseInt(undefined) is NaN, which fails the check
    if (parseInt(process.env.REFRESH_TOKEN_GRACE_PERIOD as string) > 0) { // parseInt(undefined) is NaN
      Logger.info(`[TokenManager] Refresh token grace period set from ENV variable to ${this.RefreshTokenGracePeriod} seconds`)
    }
  }

  get TokenSecret() {
    return TokenManager.TokenSecret
  }

  /**
   * Token secret is used to sign and verify JWTs
   * Set by ENV variable "JWT_SECRET_KEY" or generated and stored on server settings if not set
   */
  async initTokenSecret() {
    if (process.env.JWT_SECRET_KEY) {
      // Use user supplied token secret
      Logger.info('[TokenManager] JWT secret key set from ENV variable')
      TokenManager.TokenSecret = process.env.JWT_SECRET_KEY
    } else if (!Database.serverSettings.tokenSecret) {
      // Generate new token secret and store it on server settings
      Logger.info('[TokenManager] JWT secret key not found, generating one')
      // cast(d): require() is typed any; required here like the JS, typed as the node crypto module
      TokenManager.TokenSecret = (require('crypto') as typeof import('crypto')).randomBytes(256).toString('base64')
      Database.serverSettings.tokenSecret = TokenManager.TokenSecret
      await Database.updateServerSettings()
    } else {
      // Use existing token secret from server settings
      TokenManager.TokenSecret = Database.serverSettings.tokenSecret
    }
  }

  /**
   * Sets the refresh token cookie
   * @param req
   * @param res
   * @param refreshToken
   */
  setRefreshTokenCookie(req: Request, res: Response, refreshToken: string | null) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isRequestSecure(req),
      sameSite: 'lax',
      maxAge: this.RefreshTokenExpiry * 1000,
      path: '/'
    })
  }

  /**
   * Whether a decoded JWT payload may authenticate API/socket requests (not refresh-only credentials).
   *
   * @param decoded
   */
  static isBearerAccessTokenPayload(decoded: JwtPayload | null | undefined): boolean {
    if (!decoded?.userId) return false
    if (decoded.type === 'refresh') return false
    return true
  }

  /**
   * Function to validate a jwt token for a given user
   * Used to authenticate socket connections
   *
   * @param token
   * @returns tokens data
   */
  static validateAccessToken(token: string): JwtPayload | null {
    try {
      // Expiration is handled by the caller so expired API keys can be deactivated
      return jwt.verify(token, TokenManager.TokenSecret, { ignoreExpiration: true })
    } catch (err) {
      return null
    }
  }

  /**
   * Generate a JWT token for a given user
   * TODO: Old method with no expiration
   * @deprecated
   *
   * @param user
   */
  static generateAccessToken(user: { id: string; username: string }): string {
    return jwt.sign({ userId: user.id, username: user.username }, TokenManager.TokenSecret)
  }

  /**
   * Function to generate a jwt token for a given user
   * TODO: Old method with no expiration
   * @deprecated
   *
   * @param user
   */
  generateAccessToken(user: { id: string; username: string }): string {
    return TokenManager.generateAccessToken(user)
  }

  /**
   * Generate access token for a given user
   *
   * @param user
   */
  generateTempAccessToken(user: { id: string; username: string }): string | null {
    const payload = {
      userId: user.id,
      username: user.username,
      jti: uuid.v4(),
      type: 'access'
    }
    const options = {
      expiresIn: this.AccessTokenExpiry
    }
    try {
      return jwt.sign(payload, TokenManager.TokenSecret, options)
    } catch (error) {
      Logger.error(`[TokenManager] Error generating access token for user ${user.id}: ${error}`)
      return null
    }
  }

  /**
   * Generate refresh token for a given user
   *
   * @param user
   */
  generateRefreshToken(user: { id: string; username: string }): string | null {
    const payload = {
      userId: user.id,
      username: user.username,
      jti: uuid.v4(),
      type: 'refresh'
    }
    const options = {
      expiresIn: this.RefreshTokenExpiry
    }
    try {
      return jwt.sign(payload, TokenManager.TokenSecret, options)
    } catch (error) {
      Logger.error(`[TokenManager] Error generating refresh token for user ${user.id}: ${error}`)
      return null
    }
  }

  /**
   * Create tokens and session for a given user
   *
   * @param user
   * @param req
   */
  async createTokensAndSession(user: { id: string; username: string }, req: Request) {
    const ipAddress = requestIp.getClientIp(req)
    const userAgent = req.headers['user-agent']
    const accessToken = this.generateTempAccessToken(user)
    const refreshToken = this.generateRefreshToken(user)

    // Calculate expiration time for the refresh token
    const expiresAt = new Date(Date.now() + this.RefreshTokenExpiry * 1000)

    const session = await Database.sessionModel.createSession(user.id, ipAddress, userAgent, refreshToken, expiresAt)

    return {
      accessToken,
      refreshToken,
      session
    }
  }

  /**
   * Rotate tokens for a given session
   *
   * @param session
   * @param user
   * @param req
   * @param res
   * @param gracePeriod - whether to use the grace period
   */
  async rotateTokensForSession(session: SessionRow, user: User, req: Request, res: Response, gracePeriod = true) {
    const previousRefreshToken = session.refreshToken
    const newAccessToken = this.generateTempAccessToken(user)
    let newRefreshToken = this.generateRefreshToken(user)
    const newExpiresAt = new Date(Date.now() + this.RefreshTokenExpiry * 1000)

    let lastRefreshToken: string | null = null
    let lastRefreshTokenExpiresAt: Date | null = null
    if (gracePeriod) {
      // Set grace period of old refresh token in case of race condition in token rotation.
      // During this window a retry with the old refresh token returns the already-rotated
      // current token instead of failing, so a client that never received the rotation
      // response (e.g. dropped/suspended mobile request) can still recover the session.
      // Configurable via REFRESH_TOKEN_GRACE_PERIOD; may need to be longer if fetching the
      // user data takes longer due to large progress objects.
      lastRefreshToken = previousRefreshToken
      lastRefreshTokenExpiresAt = new Date(Date.now() + this.RefreshTokenGracePeriod * 1000)
    }

    // Only update if this session row still has the refresh token we read
    const [numUpdated] = await Database.sessionModel.update(
      {
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        lastRefreshToken,
        lastRefreshTokenExpiresAt
      },
      {
        where: {
          id: session.id,
          refreshToken: previousRefreshToken
        }
      }
    )

    if (numUpdated === 0) {
      Logger.debug(`[TokenManager] Race condition in rotateTokensForSession for user ${user.id}, getting new token`)

      // NOTE: if the session row was deleted in the meantime findOne returns null and the reads below throw
      // cast(c): typed as found; when the row was deleted findOne returns null (see NOTE above)
      const updatedSession = (await Database.sessionModel.findOne({ where: { id: session.id } })) as SessionRow

      newRefreshToken = updatedSession.refreshToken
      session.refreshToken = updatedSession.refreshToken
      session.expiresAt = updatedSession.expiresAt
      session.lastRefreshToken = updatedSession.lastRefreshToken
      session.lastRefreshTokenExpiresAt = updatedSession.lastRefreshTokenExpiresAt
    } else {
      session.refreshToken = newRefreshToken
      session.expiresAt = newExpiresAt
      session.lastRefreshToken = lastRefreshToken
      session.lastRefreshTokenExpiresAt = lastRefreshTokenExpiresAt
    }

    // Set new refresh token cookie
    this.setRefreshTokenCookie(req, res, newRefreshToken)

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    }
  }

  /**
   * Check if the jwt is valid
   *
   * @param jwt_payload
   * @param done - passportjs callback
   */
  async jwtAuthCheck(jwt_payload: JwtPayload, done: PassportDone) {
    if (jwt_payload.type === 'api') {
      // Api key based authentication
      // cast(d): api tokens are signed with a keyId by ApiKey (passport-jwt verified the signature); keyId is optional in JwtPayload
      const apiKey = await Database.apiKeyModel.getById(jwt_payload.keyId as string)

      if (!apiKey?.isActive) {
        done(null, null)
        return
      }

      // Check if the api key is expired and deactivate it
      if (jwt_payload.exp && jwt_payload.exp < Date.now() / 1000) {
        done(null, null)

        apiKey.isActive = false
        await apiKey.save()
        Logger.info(`[TokenManager] API key ${apiKey.id} is expired - deactivated`)
        return
      }

      const user = await Database.userModel.getUserById(apiKey.userId)

      if (!user?.isActive) {
        // deny login
        done(null, null)
        return
      }

      done(null, user)
    } else {
      // JWT based authentication — refresh tokens are only valid at POST /auth/refresh
      if (!TokenManager.isBearerAccessTokenPayload(jwt_payload)) {
        done(null, null)
        return
      }

      // Check if the jwt is expired
      if (jwt_payload.exp && jwt_payload.exp < Date.now() / 1000) {
        done(null, null)
        return
      }

      // load user by id from the jwt token
      // cast(d): isBearerAccessTokenPayload checked that userId is set
      const user: UserWithOldTokenFlag | null = await Database.userModel.getUserByIdOrOldId(jwt_payload.userId as string)

      if (!user?.isActive) {
        // deny login
        done(null, null)
        return
      }

      // TODO: Temporary flag to report old tokens to users
      // May be a better place for this but here means we dont have to decode the token again
      if (!jwt_payload.exp && !user.isOldToken) {
        Logger.debug(`[TokenManager] User ${user.username} is using an access token without an expiration`)
        user.isOldToken = true
      } else if (jwt_payload.exp && user.isOldToken !== undefined) {
        delete user.isOldToken
      }

      // approve login
      done(null, user)
    }
  }

  /**
   * Handle refresh token
   *
   * @param refreshToken
   * @param req
   * @param res
   */
  async handleRefreshToken(refreshToken: string, req: Request, res: Response): Promise<{ accessToken?: string | null; refreshToken?: string | null; user?: User; error?: string }> {
    try {
      // Verify the refresh token
      const decoded = jwt.verify(refreshToken, TokenManager.TokenSecret)

      if (decoded.type !== 'refresh') {
        Logger.error(`[TokenManager] Failed to refresh token. Invalid token type: ${decoded.type}`)
        return {
          error: 'Invalid token type'
        }
      }

      // cast(d): SessionRow names the refresh token columns; the Session model declares them since batch 3a, so the cast changes no type
      let session = (await Database.sessionModel.findOne({
        where: {
          [Op.or]: [{ refreshToken: refreshToken }, { lastRefreshToken: refreshToken }]
        }
      })) as SessionRow | null

      if (!session) {
        Logger.error(`[TokenManager] Failed to refresh token. Session not found`)
        return {
          error: 'Invalid refresh token'
        }
      }

      let isGracePeriod = false
      if (session.refreshToken !== refreshToken) {
        // Token matched lastRefreshToken
        if (session.lastRefreshTokenExpiresAt && session.lastRefreshTokenExpiresAt > new Date()) {
          isGracePeriod = true
          Logger.debug(`[TokenManager] Grace period hit for user ${session.userId}`)
        } else {
          Logger.debug(`[TokenManager] Grace period expired for user ${session.userId}`)
          return {
            error: 'Invalid refresh token'
          }
        }
      } else {
        // Token matched current refreshToken
        // Check if session is expired in database
        if (session.expiresAt < new Date()) {
          Logger.info(`[TokenManager] Session expired in database, cleaning up`)
          await session.destroy()
          return {
            error: 'Refresh token expired'
          }
        }
      }

      const user = await Database.userModel.getUserById(decoded.userId)
      if (!user?.isActive) {
        Logger.error(`[TokenManager] Failed to refresh token. User not found or inactive for user id: ${decoded.userId}`)
        return {
          error: 'User not found or inactive'
        }
      }

      if (isGracePeriod) {
        // Return the already rotated refresh token store in the database,
        // and generate a new access token without changing the refresh token
        // again
        const accessToken = this.generateTempAccessToken(user)
        this.setRefreshTokenCookie(req, res, session.refreshToken)

        return {
          accessToken,
          refreshToken: session.refreshToken,
          user
        }
      }

      const newTokens = await this.rotateTokensForSession(session, user, req, res)
      return {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        user
      }
    } catch (error) {
      // cast(d): catch variable is unknown; jwt.verify and the queries throw Error objects
      if ((error as Error).name === 'TokenExpiredError') {
        Logger.info(`[TokenManager] Refresh token expired, cleaning up session`)

        // Clean up the expired session from database
        try {
          await Database.sessionModel.destroy({
            where: { refreshToken: refreshToken }
          })
          Logger.info(`[TokenManager] Expired session cleaned up`)
        } catch (cleanupError) {
          // cast(d): catch variable is unknown; the query throws Error objects
          Logger.error(`[TokenManager] Error cleaning up expired session: ${(cleanupError as Error).message}`)
        }

        return {
          error: 'Refresh token expired'
        }
      // cast(d): catch variable is unknown; jwt.verify and the queries throw Error objects
      } else if ((error as Error).name === 'JsonWebTokenError') { // Error object (see above)
        // cast(d): catch variable is unknown (see above)
        Logger.error(`[TokenManager] Invalid refresh token format: ${(error as Error).message}`)
        return {
          error: 'Invalid refresh token'
        }
      } else {
        // cast(d): catch variable is unknown (see above)
        Logger.error(`[TokenManager] Refresh token error: ${(error as Error).message}`)
        return {
          error: 'Invalid refresh token'
        }
      }
    }
  }

  /**
   * Invalidate all JWT sessions for a given user
   * If user is current user and refresh token is valid, rotate tokens for the current session
   *
   * @param user
   * @param req
   * @param res
   * @returns new tokens for the current session if kept alive
   */
  async invalidateJwtSessionsForUser(user: User, req: Request, res: Response) {
    const currentRefreshToken = req.cookies.refresh_token || req.headers['x-refresh-token']
    // cast(d): the callers (MeController and UserController routes) run after the auth middleware, so req.user is set
    if ((req.user as User).id === user.id && currentRefreshToken) {
      // Current user is the same as the user to invalidate sessions for
      // So rotate token for current session
      // cast(d): SessionRow names the refresh token columns; the Session model declares them since batch 3a, so the cast changes no type
      const currentSession = (await Database.sessionModel.findOne({
        where: {
          userId: user.id,
          [Op.or]: [{ refreshToken: currentRefreshToken }, { lastRefreshToken: currentRefreshToken }]
        }
      })) as SessionRow | null
      if (currentSession) {
        const newTokens = await this.rotateTokensForSession(currentSession, user, req, res, false)

        // Invalidate all sessions for the user except the current one
        await Database.sessionModel.destroy({
          where: {
            id: {
              [Op.ne]: currentSession.id
            },
            userId: user.id
          }
        })

        return {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken
        }
      } else {
        Logger.error(`[TokenManager] No session found to rotate tokens`)
      }
    }

    // Current user is not the same as the user to invalidate sessions for (or no refresh token)
    // So invalidate all sessions for the user
    await Database.sessionModel.destroy({ where: { userId: user.id } })
    return null
  }

  /**
   * Destroy all JWT sessions for the user that owns this refresh token
   *
   * @param refreshToken
   */
  async invalidateAllSessionsForRefreshToken(refreshToken: string) {
    if (!refreshToken) return

    const session = await Database.sessionModel.findOne({
      where: {
        [Op.or]: [{ refreshToken: refreshToken }, { lastRefreshToken: refreshToken }]
      }
    })
    if (!session) return

    const numDeleted = await Database.sessionModel.destroy({ where: { userId: session.userId } })
    Logger.info(`[TokenManager] Invalidated all JWT sessions for user ${session.userId}, ${numDeleted} deleted`)
  }

  /**
   * Invalidate a refresh token - used for logout
   *
   * @param refreshToken
   */
  async invalidateRefreshToken(refreshToken: string): Promise<boolean> {
    if (!refreshToken) {
      Logger.error(`[TokenManager] No refresh token provided to invalidate`)
      return false
    }

    try {
      const numDeleted = await Database.sessionModel.destroy({ where: { refreshToken: refreshToken } })
      Logger.info(`[TokenManager] Refresh token invalidated, ${numDeleted} sessions deleted`)
      return true
    } catch (error) {
      // cast(d): catch variable is unknown; the query throws Error objects
      Logger.error(`[TokenManager] Error invalidating refresh token: ${(error as Error).message}`)
      return false
    }
  }
}

export = TokenManager
