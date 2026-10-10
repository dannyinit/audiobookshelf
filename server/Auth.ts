import type { Request, Response, NextFunction, RequestHandler, Router } from 'express'
import passport = require('passport')
import passportJwt = require('passport-jwt')

import Database = require('./Database')
import Logger = require('./Logger')
import TokenManager = require('./auth/TokenManager')
import LocalAuthStrategy = require('./auth/LocalAuthStrategy')
import OidcAuthStrategy = require('./auth/OidcAuthStrategy')

import RateLimiterFactory = require('./utils/rateLimiterFactory')
import utils = require('./utils')
import queryValue = require('./utils/queryValue')
import type User = require('./models/User')
import type ServerSettings = require('./objects/settings/ServerSettings')
import type EmailSettings = require('./objects/settings/EmailSettings')
const JwtStrategy = passportJwt.Strategy
const ExtractJwt = passportJwt.ExtractJwt
const { escapeRegExp } = utils
const { requiredString } = queryValue

/**
 * Login response payload; the login and refresh routes add the tokens to its user
 */
interface LoginResponsePayload {
  user: ReturnType<User['toOldJSONForBrowser']> & { accessToken?: string | null; refreshToken?: string | null }
  userDefaultLibraryId: ReturnType<User['getDefaultLibraryId']>
  serverSettings: ReturnType<ServerSettings['toJSONForBrowser']>
  ereaderDevices: ReturnType<EmailSettings['getEReaderDevices']>
  Source: string
}

/**
 * State the openid-client strategy keeps in the session under its session key (only what is read here)
 */
interface OidcSessionState {
  code_verifier?: Request['query'][string]
  mobile?: boolean
  sso_redirect_uri?: string
}

/**
 * Response of a failed openid-client request (attached to its errors), only what is logged
 */
interface OidcHttpResponse {
  req?: { _header: string }
  body?: unknown
}

/**
 * @class Class for handling all the authentication related functionality.
 */
class Auth {
  declare ignorePatterns: RegExp[]
  declare authRateLimiter: RequestHandler
  declare tokenManager: TokenManager
  declare localAuthStrategy: LocalAuthStrategy
  declare oidcAuthStrategy: OidcAuthStrategy

  constructor() {
    const escapedRouterBasePath = escapeRegExp(global.RouterBasePath)
    this.ignorePatterns = [new RegExp(`^(${escapedRouterBasePath}/api)?/items/[^/]+/cover$`), new RegExp(`^(${escapedRouterBasePath}/api)?/authors/[^/]+/image$`)]

    this.authRateLimiter = RateLimiterFactory.getAuthRateLimiter()

    this.tokenManager = new TokenManager()
    this.localAuthStrategy = new LocalAuthStrategy()
    this.oidcAuthStrategy = new OidcAuthStrategy()
  }

  /**
   * Checks if the request should not be authenticated.
   * @param req
   */
  authNotNeeded(req: Request): boolean {
    return req.method === 'GET' && this.ignorePatterns.some((pattern) => pattern.test(req.path))
  }

  /**
   * Middleware to register passport in express-session
   *
   * @param middleware
   */
  ifAuthNeeded(middleware: RequestHandler) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (this.authNotNeeded(req)) {
        return next()
      }
      middleware(req, res, next)
    }
  }

  /**
   * middleware to use in express to only allow authenticated users.
   *
   * @param req
   * @param res
   * @param next
   */
  isAuthenticated(req: Request, res: Response, next: NextFunction) {
    return passport.authenticate('jwt', { session: false })(req, res, next)
  }

  /**
   * Function to generate a jwt token for a given user
   * TODO: Old method with no expiration
   * @deprecated
   *
   * @param user
   */
  generateAccessToken(user: { id: string; username: string }): string {
    return this.tokenManager.generateAccessToken(user)
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
    return this.tokenManager.invalidateJwtSessionsForUser(user, req, res)
  }

  /**
   * Return the login info payload for a user
   *
   * @param user
   * @returns jsonPayload
   */
  async getUserLoginResponsePayload(user: User): Promise<LoginResponsePayload> {
    const libraryIds = await Database.libraryModel.getAllLibraryIds()
    return {
      user: user.toOldJSONForBrowser(),
      userDefaultLibraryId: user.getDefaultLibraryId(libraryIds),
      serverSettings: Database.serverSettings.toJSONForBrowser(),
      ereaderDevices: Database.emailSettings.getEReaderDevices(user),
      Source: global.Source
    }
  }

  // #region Passport strategies
  /**
   * Inializes all passportjs strategies and other passportjs ralated initialization.
   */
  async initPassportJs() {
    // Check if we should load the local strategy (username + password login)
    if (global.ServerSettings.authActiveAuthMethods.includes('local')) {
      this.localAuthStrategy.init()
    }

    // Check if we should load the openid strategy
    if (global.ServerSettings.authActiveAuthMethods.includes('openid')) {
      this.oidcAuthStrategy.init()
    }

    // Load the JwtStrategy (always) -> for bearer token auth
    passport.use(
      new JwtStrategy(
        {
          jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), ExtractJwt.fromUrlQueryParameter('token')]),
          // cast(d): TokenSecret is set by initTokenSecret (Server.init) before passport is initialized
          secretOrKey: TokenManager.TokenSecret!,
          // Handle expiration manaully in order to disable api keys that are expired
          ignoreExpiration: true
        },
        this.tokenManager.jwtAuthCheck.bind(this)
      )
    )

    // define how to seralize a user (to be put into the session)
    passport.serializeUser(function (user, cb) {
      process.nextTick(function () {
        // only store id to session
        return cb(
          null,
          JSON.stringify({
            id: user.id
          })
        )
      })
    })

    // define how to deseralize a user (use the ID to get it from the database)
    passport.deserializeUser(
      function (this: Auth, user: string, cb: (err: null, user: User | null) => void) {
        process.nextTick(
          async function () {
            const parsedUserInfo = JSON.parse(user)
            // load the user by ID that is stored in the session
            const dbUser = await Database.userModel.getUserById(parsedUserInfo.id)
            return cb(null, dbUser)
          }.bind(this)
        )
      }.bind(this)
    )
  }
  // #endregion

  /**
   * Unuse strategy
   *
   * @param name
   */
  unuseAuthStrategy(name: string) {
    if (name === 'openid') {
      this.oidcAuthStrategy.unuse()
    } else if (name === 'local') {
      this.localAuthStrategy.unuse()
    } else {
      Logger.error('[Auth] Invalid auth strategy ' + name)
    }
  }

  /**
   * Use strategy
   *
   * @param name
   */
  useAuthStrategy(name: string) {
    if (name === 'openid') {
      this.oidcAuthStrategy.init()
    } else if (name === 'local') {
      this.localAuthStrategy.init()
    } else {
      Logger.error('[Auth] Invalid auth strategy ' + name)
    }
  }

  /**
   * Returns if the given auth method is API based.
   *
   * @param authMethod
   */
  isAuthMethodAPIBased(authMethod: string): boolean {
    return ['api', 'openid-mobile'].includes(authMethod)
  }

  /**
   * Stores the client's choice of login callback method in temporary cookies.
   *
   * The `authMethod` parameter specifies the authentication strategy and can have the following values:
   * - 'local': Standard authentication,
   * - 'api': Authentication for API use
   * - 'openid': OpenID authentication directly over web
   * - 'openid-mobile': OpenID authentication, but done via an mobile device
   *
   * @param req
   * @param res
   * @param authMethod - The authentication method, default is 'local'.
   * @returns - Returns error object if validation fails, null if successful
   */
  paramsToCookies(req: Request, res: Response, authMethod = 'local'): { error: string } | null {
    const TWO_MINUTES = 120000 // 2 minutes in milliseconds
    const callback = req.query.redirect_uri || req.query.callback

    // Additional handling for non-API based authMethod
    if (!this.isAuthMethodAPIBased(authMethod)) {
      // Store 'auth_state' if present in the request
      if (req.query.state) {
        res.cookie('auth_state', req.query.state, { maxAge: TWO_MINUTES, httpOnly: true })
      }

      // Validate and store the callback URL
      if (!callback) {
        res.status(400).send({ message: 'No callback parameter' })
        return { error: 'No callback parameter' }
      }

      // Security: Validate callback URL is same-origin only
      if (!this.oidcAuthStrategy.isValidWebCallbackUrl(requiredString(callback), req)) {
        Logger.warn(`[Auth] Rejected invalid callback URL: ${callback}`)
        res.status(400).send({ message: 'Invalid callback URL - must be same-origin' })
        return { error: 'Invalid callback URL - must be same-origin' }
      }

      res.cookie('auth_cb', callback, { maxAge: TWO_MINUTES, httpOnly: true })
    }

    // Store the authentication method for long
    Logger.debug(`[Auth] paramsToCookies: setting auth_method cookie to ${authMethod}`)
    res.cookie('auth_method', authMethod, { maxAge: 1000 * 60 * 60 * 24 * 365 * 10, httpOnly: true })
    return null
  }

  /**
   * Informs the client in the right mode about a successfull login and the token
   * (clients choise is restored from cookies).
   *
   * @param req
   * @param res
   */
  async handleLoginSuccessBasedOnCookie(req: Request, res: Response) {
    // Handle token generation and get userResponse object
    // For API based auth (e.g. mobile), we will return the refresh token in the response
    const isApiBased = this.isAuthMethodAPIBased(req.cookies.auth_method)
    Logger.debug(`[Auth] handleLoginSuccessBasedOnCookie: isApiBased: ${isApiBased}, auth_method: ${req.cookies.auth_method}`)
    const userResponse = await this.handleLoginSuccess(req, res, isApiBased)

    if (isApiBased) {
      // REST request - send data
      res.json(userResponse)
    } else {
      // UI request -> check if we have a callback url
      if (req.cookies.auth_cb) {
        let stateQuery = req.cookies.auth_state ? `&state=${req.cookies.auth_state}` : ''
        // UI request -> redirect to auth_cb url and send the jwt token as parameter
        // TODO: Temporarily continue sending the old token as setToken
        res.redirect(302, `${req.cookies.auth_cb}?setToken=${userResponse.user.token}&accessToken=${userResponse.user.accessToken}${stateQuery}`)
      } else {
        res.status(400).send('No callback or already expired')
      }
    }
  }

  /**
   * After login success from local or oidc
   * req.user is set by passport.authenticate
   *
   * attaches the access token to the user in the response
   * if returnTokens is true, also attaches the refresh token to the user in the response
   *
   * if returnTokens is false, sets the refresh token cookie
   *
   * @param req
   * @param res
   * @param returnTokens
   */
  async handleLoginSuccess(req: Request, res: Response, returnTokens = false) {
    // Create tokens and session
    // cast(d): req.user is set by passport.authenticate before this runs (see above)
    const { accessToken, refreshToken } = await this.tokenManager.createTokensAndSession(req.user!, req)

    // cast(d): req.user is set by passport.authenticate (see above)
    const userResponse = await this.getUserLoginResponsePayload(req.user!)

    userResponse.user.refreshToken = returnTokens ? refreshToken : null
    userResponse.user.accessToken = accessToken

    Logger.debug(`[Auth] handleLoginSuccess: returnTokens: ${returnTokens}, isRefreshTokenInResponse: ${!!userResponse.user.refreshToken}`)

    if (!returnTokens) {
      this.tokenManager.setRefreshTokenCookie(req, res, refreshToken)
    }

    return userResponse
  }

  // #region Auth routes
  /**
   * Creates all (express) routes required for authentication.
   *
   * @param router
   */
  async initAuthRoutes(router: Router) {
    // Local strategy login route (takes username and password)
    router.post('/login', this.authRateLimiter, passport.authenticate('local'), async (req, res) => {
      // Check if mobile app wants refresh token in response
      const returnTokens = req.headers['x-return-tokens'] === 'true'

      const userResponse = await this.handleLoginSuccess(req, res, returnTokens)
      res.json(userResponse)
    })

    // Refresh token route
    router.post('/auth/refresh', this.authRateLimiter, async (req, res) => {
      let refreshToken = req.cookies.refresh_token

      // If x-refresh-token header is present, use it instead of the cookie
      // and return the refresh token in the response
      let shouldReturnRefreshToken = false
      if (req.headers['x-refresh-token']) {
        refreshToken = req.headers['x-refresh-token']
        shouldReturnRefreshToken = true
      }

      if (!refreshToken) {
        Logger.error(`[Auth] Failed to refresh token. No refresh token provided`)
        return res.status(401).json({ error: 'No refresh token provided' })
      }

      Logger.debug(`[Auth] refreshing token. shouldReturnRefreshToken: ${shouldReturnRefreshToken}`)

      const refreshResponse = await this.tokenManager.handleRefreshToken(refreshToken, req, res)
      if (refreshResponse.error) {
        return res.status(401).json({ error: refreshResponse.error })
      }

      // cast(d): handleRefreshToken returns the user when there is no error (checked above)
      const userResponse = await this.getUserLoginResponsePayload(refreshResponse.user!)

      userResponse.user.accessToken = refreshResponse.accessToken
      userResponse.user.refreshToken = shouldReturnRefreshToken ? refreshResponse.refreshToken : null
      res.json(userResponse)
    })

    // openid strategy login route (this redirects to the configured openid login provider)
    router.get('/auth/openid', this.authRateLimiter, (req, res) => {
      const authorizationUrlResponse = this.oidcAuthStrategy.getAuthorizationUrl(req)

      if (authorizationUrlResponse.error) {
        return res.status(authorizationUrlResponse.status).send(authorizationUrlResponse.error)
      }

      // Check if paramsToCookies sent a response (e.g., due to invalid callback URL)
      const cookieResult = this.paramsToCookies(req, res, authorizationUrlResponse.isMobileFlow ? 'openid-mobile' : 'openid')
      if (cookieResult && cookieResult.error) {
        return // Response already sent by paramsToCookies
      }

      // cast(d): the url is set when there is no error (checked above)
      res.redirect(authorizationUrlResponse.authorizationUrl!)
    })

    // This will be the oauth2 callback route for mobile clients
    // It will redirect to an app-link like audiobookshelf://oauth
    router.get('/auth/openid/mobile-redirect', this.authRateLimiter, (req, res) => this.oidcAuthStrategy.handleMobileRedirect(req, res))

    // openid strategy callback route (this receives the token from the configured openid login provider)
    router.get(
      '/auth/openid/callback',
      this.authRateLimiter,
      (req, res, next) => {
        const sessionKey = this.oidcAuthStrategy.getStrategy()._key

        // cast(b): express-session types the session without the keys strategies store under their own session key
        if (!(req.session as unknown as Record<string, OidcSessionState | undefined>)[sessionKey]) {
          return res.status(400).send('No session')
        }

        // If the client sends us a code_verifier, we will tell passport to use this to send this in the token request
        // The code_verifier will be validated by the oauth2 provider by comparing it to the code_challenge in the first request
        // Crucial for API/Mobile clients
        if (req.query.code_verifier) {
          // cast(b): as above; the session state was checked above
          (req.session as unknown as Record<string, OidcSessionState>)[sessionKey].code_verifier = req.query.code_verifier
        }

        function handleAuthError(isMobile: boolean, errorCode: number, errorMessage: string, logMessage: string, response?: OidcHttpResponse) {
          Logger.error(JSON.stringify(logMessage, null, 2))
          if (response) {
            // Depending on the error, it can also have a body
            // We also log the request header the passport plugin sents for the URL
            const header = response.req?._header.replace(/Authorization: [^\r\n]*/i, 'Authorization: REDACTED')
            Logger.debug(header + '\n' + JSON.stringify(response.body, null, 2))
          }

          if (isMobile) {
            return res.status(errorCode).send(errorMessage)
          } else {
            return res.redirect(`/login?error=${encodeURIComponent(errorMessage)}&autoLaunch=0`)
          }
        }

        function passportCallback(req: Request, res: Response, next: NextFunction) {
          return (err: { response?: OidcHttpResponse } | null, user: (User & { openid_id_token?: string }) | false | null, info: { response?: OidcHttpResponse } | undefined) => {
            // cast(b): as above
            const isMobile = (req.session as unknown as Record<string, OidcSessionState | undefined>)[sessionKey]?.mobile === true
            if (err) {
              return handleAuthError(isMobile, 500, 'Error in callback', `[Auth] Error in openid callback - ${err}`, err?.response)
            }

            if (!user) {
              // Info usually contains the error message from the SSO provider
              return handleAuthError(isMobile, 401, 'Unauthorized', `[Auth] No data in openid callback - ${info}`, info?.response)
            }

            req.logIn(user, (loginError) => {
              if (loginError) {
                return handleAuthError(isMobile, 500, 'Error during login', `[Auth] Error in openid callback: ${loginError}`)
              }

              // The id_token does not provide access to the user, but is used to identify the user to the SSO provider
              //   instead it containts a JWT with userinfo like user email, username, etc.
              //   the client will get to know it anyway in the logout url according to the oauth2 spec
              //   so it is safe to send it to the client, but we use strict settings
              // cast(b): express types sameSite in lower case; the cookie module lower-cases the value, so 'Strict' is sent as Strict
              res.cookie('openid_id_token', user.openid_id_token, { maxAge: 1000 * 60 * 60 * 24 * 365 * 10, httpOnly: true, secure: true, sameSite: 'Strict' as 'strict' })
              next()
            })
          }
        }

        // While not required by the standard, the passport plugin re-sends the original redirect_uri in the token request
        // We need to set it correctly, as some SSO providers (e.g. keycloak) check that parameter when it is provided
        // We set it here again because the passport param can change between requests
        // cast(b): as above; the session state was checked above
        // cast(b): the openid-client strategy takes redirect_uri, passport's AuthenticateOptions does not declare it
        return passport.authenticate('openid-client', { redirect_uri: (req.session as unknown as Record<string, OidcSessionState>)[sessionKey].sso_redirect_uri } as passport.AuthenticateOptions & { redirect_uri?: string }, passportCallback(req, res, next))(req, res, next)
      },
      // on a successfull login: read the cookies and react like the client requested (callback or json)
      this.handleLoginSuccessBasedOnCookie.bind(this)
    )

    /**
     * Helper route used to auto-populate the openid URLs in config/authentication
     * Takes an issuer URL as a query param and requests the config data at "/.well-known/openid-configuration"
     *
     * @example /auth/openid/config?issuer=http://192.168.1.66:9000/application/o/audiobookshelf/
     */
    router.get('/auth/openid/config', this.authRateLimiter, this.isAuthenticated, async (req, res) => {
      // cast(d): req.user is set by isAuthenticated (the middleware before this handler)
      if (!req.user!.isAdminOrUp) {
        // cast(d): req.user is set by isAuthenticated (see above)
        Logger.error(`[Auth] Non-admin user "${req.user!.username}" attempted to get issuer config`)
        return res.sendStatus(403)
      }

      if (!req.query.issuer || typeof req.query.issuer !== 'string') {
        return res.status(400).send("Invalid request. Query param 'issuer' is required")
      }

      // The config has no error or status, so the error result is told apart by its error
      const openIdIssuerConfig: (Exclude<Awaited<ReturnType<OidcAuthStrategy['getIssuerConfig']>>, { error: string }> & { error?: undefined; status?: undefined }) | { status: number; error: string } = await this.oidcAuthStrategy.getIssuerConfig(req.query.issuer)
      if (openIdIssuerConfig.error) {
        return res.status(openIdIssuerConfig.status).send(openIdIssuerConfig.error)
      }

      res.json(openIdIssuerConfig)
    })

    /**
     * Logout route
     * Use ?allDevices=1 to destroy every session for this user instead of just the current one
     */
    router.post('/logout', async (req, res) => {
      // Refresh token be alternatively be sent in the header
      const refreshToken = req.cookies.refresh_token || req.headers['x-refresh-token']
      const allDevices = req.query.allDevices === '1'

      // Clear refresh token cookie
      res.clearCookie('refresh_token', {
        path: '/'
      })

      if (allDevices) {
        await this.tokenManager.invalidateAllSessionsForRefreshToken(refreshToken)
      } else if (refreshToken) {
        await this.tokenManager.invalidateRefreshToken(refreshToken)
      } else {
        Logger.info(`[Auth] logout: No refresh token on request`)
      }

      req.logout((err) => {
        if (err) {
          res.sendStatus(500)
        } else {
          const authMethod = req.cookies.auth_method

          res.clearCookie('auth_method')

          let logoutUrl = null

          if (authMethod === 'openid' || authMethod === 'openid-mobile') {
            logoutUrl = this.oidcAuthStrategy.getEndSessionUrl(req, req.cookies.openid_id_token, authMethod)
            res.clearCookie('openid_id_token')
          }

          // Tell the user agent (browser) to redirect to the authentification provider's logout URL
          // (or redirect_url: null if we don't have one)
          res.send({ redirect_url: logoutUrl })
        }
      })
    })
  }
  // #endregion
}

export = Auth
