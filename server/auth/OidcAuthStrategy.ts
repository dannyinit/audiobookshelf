import type { Request, Response } from 'express'
import passport = require('passport')
import OpenIDClient = require('openid-client')
import axios from 'axios'
import Database = require('../Database')
import Logger = require('../Logger')
import requestUtils = require('../utils/requestUtils')
import type User = require('../models/User')
import type { PassportDone } from './types'
const { getRequestOrigin } = requestUtils

/**
 * openid-client Strategy with the internal fields read here (not in its types)
 */
type OidcStrategy = OpenIDClient.Strategy<User> & {
  /** Session key the strategy stores its state under */
  _key: string
  _params: OpenIDClient.AuthorizationParameters
}

/**
 * User model as used in the verify callback
 */
type OidcUser = User & { error?: string; openid_id_token?: string }

/**
 * Query params read by the openid routes
 */
type OidcQuery = Partial<Record<'response_type' | 'redirect_uri' | 'code_challenge' | 'code_challenge_method' | 'state' | 'code', string>>

/**
 * OpenID userinfo; claim names (group claim, advanced permissions claim) come from the server settings
 */
type OidcUserinfo = OpenIDClient.UserinfoResponse & Record<string, unknown>

interface OpenIdIssuerConfig {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  end_session_endpoint: string
  jwks_uri: string
  id_token_signing_alg_values_supported: string
}

/**
 * PKCE parameters for the authorization request, or an error
 */
interface PkceData {
  code_challenge?: string
  code_challenge_method?: string
  code_verifier?: string
  error?: string
}

/**
 * OpenID Connect authentication strategy
 */
class OidcAuthStrategy {
  declare name: string
  declare strategy: OidcStrategy | null
  declare client: OpenIDClient.BaseClient | null
  declare openIdAuthSession: Map<string, { mobile_redirect_uri: string }>

  constructor() {
    this.name = 'openid-client'
    this.strategy = null
    this.client = null
    // Map of openId sessions indexed by oauth2 state-variable
    this.openIdAuthSession = new Map()
  }

  /**
   * Get the passport strategy instance
   */
  getStrategy(): OidcStrategy {
    if (!this.strategy) {
      // Typed with the internal fields read in getAuthorizationUrl
      this.strategy = new OpenIDClient.Strategy(
        {
          client: this.getClient(),
          params: {
            redirect_uri: `${global.ServerSettings.authOpenIDSubfolderForRedirectURLs}/auth/openid/callback`,
            scope: this.getScope()
          }
        },
        this.verifyCallback.bind(this)
      ) as OidcStrategy
    }
    return this.strategy
  }

  /**
   * Get the OpenID Connect client
   */
  getClient(): OpenIDClient.BaseClient {
    if (!this.client) {
      if (!Database.serverSettings.isOpenIDAuthSettingsValid) {
        throw new Error('OpenID Connect settings are not valid')
      }

      // Custom req timeout see: https://github.com/panva/node-openid-client/blob/main/docs/README.md#customizing
      OpenIDClient.custom.setHttpOptionsDefaults({ timeout: 10000 })

      // Settings were checked valid above; a null logout URL is passed through, like the JS
      const openIdIssuerClient = new OpenIDClient.Issuer({
        issuer: global.ServerSettings.authOpenIDIssuerURL,
        authorization_endpoint: global.ServerSettings.authOpenIDAuthorizationURL,
        token_endpoint: global.ServerSettings.authOpenIDTokenURL,
        userinfo_endpoint: global.ServerSettings.authOpenIDUserInfoURL,
        jwks_uri: global.ServerSettings.authOpenIDJwksURL,
        end_session_endpoint: global.ServerSettings.authOpenIDLogoutURL
      } as OpenIDClient.IssuerMetadata).Client

      // Settings were checked valid above
      this.client = new openIdIssuerClient({
        client_id: global.ServerSettings.authOpenIDClientID,
        client_secret: global.ServerSettings.authOpenIDClientSecret,
        id_token_signed_response_alg: global.ServerSettings.authOpenIDTokenSigningAlgorithm
      } as OpenIDClient.ClientMetadata)
    }
    return this.client
  }

  /**
   * Get the scope string for the OpenID Connect request
   */
  getScope(): string {
    let scope = 'openid profile email'
    if (global.ServerSettings.authOpenIDGroupClaim) {
      scope += ' ' + global.ServerSettings.authOpenIDGroupClaim
    }
    if (global.ServerSettings.authOpenIDAdvancedPermsClaim) {
      scope += ' ' + global.ServerSettings.authOpenIDAdvancedPermsClaim
    }
    return scope
  }

  /**
   * Initialize the strategy with passport
   */
  init() {
    if (!Database.serverSettings.isOpenIDAuthSettingsValid) {
      Logger.error(`[OidcAuth] Cannot init openid auth strategy - invalid settings`)
      return
    }
    passport.use(this.name, this.getStrategy())
  }

  /**
   * Remove the strategy from passport
   */
  unuse() {
    passport.unuse(this.name)
    this.strategy = null
    this.client = null
  }

  /**
   * Verify callback for OpenID Connect authentication
   * @param tokenset
   * @param userinfo
   * @param done - Passport callback
   */
  async verifyCallback(tokenset: OpenIDClient.TokenSet, userinfo: OidcUserinfo, done: PassportDone) {
    let isNewUser = false
    // Starts as null; typed as the user so the reads below type check (see the NOTE below)
    let user = null as unknown as OidcUser
    try {
      Logger.debug(`[OidcAuth] openid callback userinfo=`, JSON.stringify(userinfo, null, 2))

      if (!userinfo.sub) {
        throw new Error('Invalid userinfo, no sub')
      }

      if (!this.validateGroupClaim(userinfo)) {
        throw new Error(`Group claim ${Database.serverSettings.authOpenIDGroupClaim} not found or empty in userinfo`)
      }

      // The { error } result is checked right below
      user = (await Database.userModel.findUserFromOpenIdUserInfo(userinfo)) as OidcUser

      if (user?.error) {
        throw new Error('Invalid userinfo or already linked')
      }

      if (!user) {
        // If no existing user was matched, auto-register if configured
        if (global.ServerSettings.authOpenIDAutoRegister) {
          Logger.info(`[User] openid: Auto-registering user with sub "${userinfo.sub}"`, userinfo)
          // cast(d): create returns the new user (the null branch of createUserFromOpenIdUserInfo is not reached)
          user = (await Database.userModel.createUserFromOpenIdUserInfo(userinfo)) as OidcUser
          isNewUser = true
        } else {
          Logger.warn(`[User] openid: User not found and auto-register is disabled`)
        }
      }

      // NOTE: when no user was found and auto-register is off, user is null and this read throws a TypeError, so the 'User not active or not found' error is never thrown for that case (the login still fails)
      if (!user.isActive) {
        throw new Error('User not active or not found')
      }

      await this.setUserGroup(user, userinfo)
      await this.updateUserPermissions(user, userinfo)

      // We also have to save the id_token for later (used for logout) because we cannot set cookies here
      user.openid_id_token = tokenset.id_token

      return done(null, user)
    } catch (error) {
      // Errors thrown above are Error objects
      Logger.error(`[OidcAuth] openid callback error: ${(error as Error)?.message}\n${(error as Error)?.stack}`)
      // Remove new user if an error occurs
      if (isNewUser && user) {
        await user.destroy()
      }
      return done(null, null, 'Unauthorized')
    }
  }

  /**
   * Validates the presence and content of the group claim in userinfo.
   * @param userinfo
   */
  validateGroupClaim(userinfo: OidcUserinfo): boolean {
    const groupClaimName = Database.serverSettings.authOpenIDGroupClaim
    if (!groupClaimName)
      // Allow no group claim when configured like this
      return true

    // If configured it must exist in userinfo
    if (!userinfo[groupClaimName]) {
      return false
    }
    return true
  }

  /**
   * Sets the user group based on group claim in userinfo.
   * @param user
   * @param userinfo
   */
  async setUserGroup(user: User, userinfo: OidcUserinfo) {
    const groupClaimName = Database.serverSettings.authOpenIDGroupClaim
    if (!groupClaimName)
      // No group claim configured, don't set anything
      return

    if (!userinfo[groupClaimName]) throw new Error(`Group claim ${groupClaimName} not found in userinfo`)

    // The group claim is a list of group names
    const groupsList = (userinfo[groupClaimName] as string[]).map((group) => group.toLowerCase())
    const rolesInOrderOfPriority = ['admin', 'user', 'guest']

    let userType = rolesInOrderOfPriority.find((role) => groupsList.includes(role))
    if (userType) {
      if (user.type === 'root') {
        // Check OpenID Group
        if (userType !== 'admin') {
          throw new Error(`Root user "${user.username}" cannot be downgraded to ${userType}. Denying login.`)
        } else {
          // If root user is logging in via OpenID, we will not change the type
          return
        }
      }

      if (user.type !== userType) {
        Logger.info(`[OidcAuth] openid callback: Updating user "${user.username}" type to "${userType}" from "${user.type}"`)
        user.type = userType
        await user.save()
      }
    } else {
      throw new Error(`No valid group found in userinfo: ${JSON.stringify(userinfo[groupClaimName], null, 2)}`)
    }
  }

  /**
   * Updates user permissions based on the advanced permissions claim.
   * @param user
   * @param userinfo
   */
  async updateUserPermissions(user: User, userinfo: OidcUserinfo) {
    const absPermissionsClaim = Database.serverSettings.authOpenIDAdvancedPermsClaim
    if (!absPermissionsClaim)
      // No advanced permissions claim configured, don't set anything
      return

    if (user.type === 'admin' || user.type === 'root') return

    const absPermissions = userinfo[absPermissionsClaim]
    if (!absPermissions) throw new Error(`Advanced permissions claim ${absPermissionsClaim} not found in userinfo`)

    // cast(d): the claim holds the permissions JSON object (updatePermissionsFromExternalJSON throws on keys it does not know)
    if (await user.updatePermissionsFromExternalJSON(absPermissions as Parameters<User['updatePermissionsFromExternalJSON']>[0])) {
      Logger.info(`[OidcAuth] openid callback: Updating advanced perms for user "${user.username}" using "${JSON.stringify(absPermissions)}"`)
    }
  }

  /**
   * Generate PKCE parameters for the authorization request
   * @param req
   * @param isMobileFlow
   */
  generatePkce(req: Request, isMobileFlow: unknown): PkceData {
    // Query params are read as strings
    const query = req.query as OidcQuery
    if (isMobileFlow) {
      if (!query.code_challenge) {
        return {
          error: 'code_challenge required for mobile flow (PKCE)'
        }
      }
      if (query.code_challenge_method && query.code_challenge_method !== 'S256') {
        return {
          error: 'Only S256 code_challenge_method method supported'
        }
      }
      return {
        code_challenge: query.code_challenge,
        code_challenge_method: query.code_challenge_method || 'S256'
      }
    } else {
      const code_verifier = OpenIDClient.generators.codeVerifier()
      const code_challenge = OpenIDClient.generators.codeChallenge(code_verifier)
      return { code_challenge, code_challenge_method: 'S256', code_verifier }
    }
  }

  /**
   * Check if a redirect URI is valid
   * @param uri
   */
  isValidRedirectUri(uri: string): boolean {
    // Check if the redirect_uri is in the whitelist
    return Database.serverSettings.authOpenIDMobileRedirectURIs.includes(uri) || (Database.serverSettings.authOpenIDMobileRedirectURIs.length === 1 && Database.serverSettings.authOpenIDMobileRedirectURIs[0] === '*')
  }

  /**
   * Get the authorization URL for OpenID Connect
   * Calls client manually because the strategy does not support forwarding the code challenge for the mobile flow
   * @param req
   */
  getAuthorizationUrl(req: Request): { authorizationUrl: string; isMobileFlow: unknown; status?: undefined; error?: undefined } | { status: number; error: string; authorizationUrl?: undefined; isMobileFlow?: undefined } {
    // Query params are read as strings
    const query = req.query as OidcQuery
    const client = this.getClient()
    const strategy = this.getStrategy()
    const sessionKey = strategy._key

    try {
      const { origin } = getRequestOrigin(req)
      const hostUrl = new URL(origin)
      const isMobileFlow = query.response_type === 'code' || query.redirect_uri || query.code_challenge

      // Only allow code flow (for mobile clients)
      if (query.response_type && query.response_type !== 'code') {
        Logger.debug(`[OidcAuth] OIDC Invalid response_type=${query.response_type}`)
        return {
          status: 400,
          error: 'Invalid response_type, only code supported'
        }
      }

      // Generate a state on web flow or if no state supplied
      const state = !isMobileFlow || !query.state ? OpenIDClient.generators.random() : query.state

      // Redirect URL for the SSO provider
      let redirectUri: string
      if (isMobileFlow) {
        // Mobile required redirect uri
        // If it is in the whitelist, we will save into this.openIdAuthSession and set the redirect uri to /auth/openid/mobile-redirect
        //    where we will handle the redirect to it
        if (!query.redirect_uri || !this.isValidRedirectUri(query.redirect_uri)) {
          Logger.debug(`[OidcAuth] Invalid redirect_uri=${query.redirect_uri}`)
          return {
            status: 400,
            error: 'Invalid redirect_uri'
          }
        }
        // We cannot save the supplied redirect_uri in the session, because it the mobile client uses browser instead of the API
        //   for the request to mobile-redirect and as such the session is not shared
        this.openIdAuthSession.set(state, { mobile_redirect_uri: query.redirect_uri })

        redirectUri = new URL(`${global.ServerSettings.authOpenIDSubfolderForRedirectURLs}/auth/openid/mobile-redirect`, hostUrl).toString()
      } else {
        redirectUri = new URL(`${global.ServerSettings.authOpenIDSubfolderForRedirectURLs}/auth/openid/callback`, hostUrl).toString()

        if (query.state) {
          Logger.debug(`[OidcAuth] Invalid state - not allowed on web openid flow`)
          return {
            status: 400,
            error: 'Invalid state, not allowed on web flow'
          }
        }
      }

      // Update the strategy's redirect_uri for this request
      strategy._params.redirect_uri = redirectUri
      Logger.debug(`[OidcAuth] OIDC redirect_uri=${redirectUri}`)

      const pkceData = this.generatePkce(req, isMobileFlow)
      if (pkceData.error) {
        return {
          status: 400,
          error: pkceData.error
        }
      }

      // Index the session by the strategy's session key
      const session = req.session as unknown as Record<string, object | undefined>
      session[sessionKey] = {
        ...session[sessionKey],
        state: state,
        max_age: strategy._params.max_age,
        response_type: 'code',
        code_verifier: pkceData.code_verifier, // not null if web flow
        mobile: query.redirect_uri, // Used in the abs callback later, set mobile if redirect_uri is filled out
        sso_redirect_uri: redirectUri // Save the redirect_uri (for the SSO Provider) for the callback
      }

      const authorizationUrl = client.authorizationUrl({
        ...strategy._params,
        redirect_uri: redirectUri,
        state: state,
        response_type: 'code',
        scope: this.getScope(),
        code_challenge: pkceData.code_challenge,
        code_challenge_method: pkceData.code_challenge_method
      })

      return {
        authorizationUrl,
        isMobileFlow
      }
    } catch (error) {
      // Errors thrown above are Error objects
      Logger.error(`[OidcAuth] Error generating authorization URL: ${error}\n${(error as Error)?.stack}`)
      return {
        status: 500,
        // Error object (see above)
        error: (error as Error).message || 'Unknown error'
      }
    }
  }

  /**
   * Get the end session URL for logout
   * @param req
   * @param idToken
   * @param authMethod
   */
  getEndSessionUrl(req: Request, idToken: string, authMethod: string): string | null {
    const client = this.getClient()

    // The issuer exposes its metadata fields directly (end_session_endpoint is a string or unset)
    const issuer = client.issuer as OpenIDClient.Issuer<OpenIDClient.BaseClient> & OpenIDClient.IssuerMetadata
    if (issuer.end_session_endpoint && issuer.end_session_endpoint.length > 0) {
      let postLogoutRedirectUri: string | null = null

      if (authMethod === 'openid') {
        const { origin } = getRequestOrigin(req)
        // TODO: ABS does currently not support subfolders for installation
        // If we want to support it we need to include a config for the serverurl
        postLogoutRedirectUri = `${origin}${global.RouterBasePath}/login`
      }
      // else for openid-mobile we keep postLogoutRedirectUri on null
      //  nice would be to redirect to the app here, but for example Authentik does not implement
      //  the post_logout_redirect_uri parameter at all and for other providers
      //  we would also need again to implement (and even before get to know somehow for 3rd party apps)
      //  the correct app link like audiobookshelf://login (and maybe also provide a redirect like mobile-redirect).
      //   Instead because its null (and this way the parameter will be omitted completly), the client/app can simply append something like
      //  &post_logout_redirect_uri=audiobookshelf://login to the received logout url by itself which is the simplest solution
      //   (The URL needs to be whitelisted in the config of the SSO/ID provider)

      return client.endSessionUrl({
        id_token_hint: idToken,
        // undefined and null both leave the parameter out
        post_logout_redirect_uri: postLogoutRedirectUri as string | undefined
      })
    }

    return null
  }

  /**
   * Get OpenID Connect configuration from an issuer URL
   * @param issuerUrl
   */
  async getIssuerConfig(issuerUrl: string): Promise<OpenIdIssuerConfig | { status: number; error: string }> {
    // Strip trailing slash
    if (issuerUrl.endsWith('/')) issuerUrl = issuerUrl.slice(0, -1)

    // Append config pathname and validate URL
    let configUrl: URL | null = null
    try {
      configUrl = new URL(`${issuerUrl}/.well-known/openid-configuration`)
      if (!configUrl.pathname.endsWith('/.well-known/openid-configuration')) {
        throw new Error('Invalid pathname')
      }
    } catch (error) {
      Logger.error(`[OidcAuth] Failed to get openid configuration. Invalid URL "${configUrl}"`, error)
      return {
        status: 400,
        error: "Invalid request. Query param 'issuer' is invalid"
      }
    }

    try {
      // configUrl was set in the try block above (it returns otherwise)
      const { data } = await axios.get((configUrl as URL).toString())
      return {
        issuer: data.issuer,
        authorization_endpoint: data.authorization_endpoint,
        token_endpoint: data.token_endpoint,
        userinfo_endpoint: data.userinfo_endpoint,
        end_session_endpoint: data.end_session_endpoint,
        jwks_uri: data.jwks_uri,
        id_token_signing_alg_values_supported: data.id_token_signing_alg_values_supported
      }
    } catch (error) {
      Logger.error(`[OidcAuth] Failed to get openid configuration at "${configUrl}"`, error)
      return {
        status: 400,
        error: 'Failed to get openid configuration'
      }
    }
  }

  /**
   * Handle mobile redirect for OAuth2 callback
   * @param req
   * @param res
   */
  handleMobileRedirect(req: Request, res: Response) {
    try {
      // Extract the state parameter from the request
      // Query params are read as strings
      const { state, code } = req.query as OidcQuery

      // Check if the state provided is in our list
      if (!state || !this.openIdAuthSession.has(state)) {
        Logger.error('[OidcAuth] /auth/openid/mobile-redirect route: State parameter mismatch')
        return res.status(400).send('State parameter mismatch')
      }

      // has(state) was checked above
      let mobile_redirect_uri = this.openIdAuthSession.get(state)!.mobile_redirect_uri

      if (!mobile_redirect_uri) {
        Logger.error('[OidcAuth] No redirect URI')
        return res.status(400).send('No redirect URI')
      }

      this.openIdAuthSession.delete(state)

      // encodeURIComponent stringifies undefined, like the JS
      const redirectUri = `${mobile_redirect_uri}?code=${encodeURIComponent(code as string)}&state=${encodeURIComponent(state)}`
      // Redirect to the overwrite URI saved in the map
      res.redirect(redirectUri)
    } catch (error) {
      // Errors thrown above are Error objects
      Logger.error(`[OidcAuth] Error in /auth/openid/mobile-redirect route: ${error}\n${(error as Error)?.stack}`)
      res.status(500).send('Internal Server Error')
    }
  }

  /**
   * Validates if a callback URL is safe for redirect (same-origin only)
   * @param callbackUrl - The callback URL to validate
   * @param req - Express request object to get current host
   * @returns - True if the URL is safe (same-origin), false otherwise
   */
  isValidWebCallbackUrl(callbackUrl: string, req: Request): boolean {
    if (!callbackUrl) return false

    try {
      // Reject protocol-relative (//host) and backslash-prefixed (/\host) values,
      // which browsers resolve to a cross-origin absolute URL.
      if (callbackUrl.startsWith('//') || callbackUrl.startsWith('/\\')) {
        Logger.warn(`[OidcAuth] Rejected protocol-relative callback URL: ${callbackUrl}`)
        return false
      }

      const { origin: serverOrigin } = getRequestOrigin(req)
      const resolvedUrl = callbackUrl.startsWith('/') ? new URL(callbackUrl, serverOrigin) : new URL(callbackUrl)

      if (resolvedUrl.origin !== serverOrigin) {
        Logger.warn(`[OidcAuth] Rejected callback URL to different origin: ${callbackUrl} (expected ${serverOrigin})`)
        return false
      }

      const pathname = decodeURIComponent(resolvedUrl.pathname)
      if (pathname.startsWith('//') || pathname.startsWith('/\\')) {
        Logger.warn(`[OidcAuth] Rejected protocol-relative callback URL path: ${callbackUrl}`)
        return false
      }

      if (!resolvedUrl.pathname.startsWith(global.RouterBasePath + '/')) {
        Logger.warn(`[OidcAuth] Rejected callback URL outside router base path: ${callbackUrl}`)
        return false
      }

      return true
    } catch (error) {
      Logger.error(`[OidcAuth] Invalid callback URL format: ${callbackUrl}`, error)
      return false
    }
  }
}

export = OidcAuthStrategy
