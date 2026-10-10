import Path = require('path')
import packageJson = require('../../../package.json')
import constants = require('../../utils/constants')
import Logger = require('../../Logger')
import User = require('../../models/User')
import htmlSanitizer = require('../../utils/htmlSanitizer')
const { BookshelfView } = constants
const { sanitize } = htmlSanitizer

const PATCHABLE_SETTINGS_KEYS = new Set([
  'scannerParseSubtitle',
  'scannerFindCovers',
  'scannerCoverProvider',
  'scannerPreferMatchedMetadata',
  'scannerDisableWatcher',
  'storeCoverWithItem',
  'storeMetadataWithItem',
  'allowIframe',
  'allowedOrigins',
  'backupSchedule',
  'backupsToKeep',
  'maxBackupSize',
  'logLevel',
  'homeBookshelfView',
  'bookshelfView',
  'dateFormat',
  'timeFormat',
  'language',
  'chromecastEnabled',
  'sortingIgnorePrefix'
])

/**
 * Stored server settings (see toJSON), the input of the constructor. Older versions stored some other keys.
 */
type ServerSettingsData = Partial<ServerSettingsJSON> & {
  /** Renamed to storeCoverWithItem in 2.0.0 */
  storeCoverWithBook?: boolean
  /** Renamed to storeMetadataWithItem in 2.0.0 */
  storeMetadataWithBook?: boolean
}

type ServerSettingsJSON = ReturnType<ServerSettings['toJSON']>

class ServerSettings {
  static patchableSettingsKeys = PATCHABLE_SETTINGS_KEYS
  declare id: string
  /** JWT secret key ONLY used when JWT_SECRET_KEY is not set in ENV */
  declare tokenSecret: string | null
  declare scannerParseSubtitle: boolean
  declare scannerFindCovers: boolean
  declare scannerCoverProvider: string
  declare scannerPreferMatchedMetadata: boolean
  declare scannerDisableWatcher: boolean
  declare storeCoverWithItem: boolean
  declare storeMetadataWithItem: boolean
  declare metadataFileFormat: string
  declare rateLimitLoginRequests: number
  declare rateLimitLoginWindow: number
  declare allowIframe: boolean
  declare backupPath: string
  declare backupSchedule: string | false
  declare backupsToKeep: number
  declare maxBackupSize: number
  declare loggerDailyLogsToKeep: number
  declare loggerScannerLogsToKeep: number
  declare homeBookshelfView: number
  declare bookshelfView: number
  declare podcastEpisodeSchedule: string
  declare sortingIgnorePrefix: boolean
  declare sortingPrefixes: string[]
  declare chromecastEnabled: boolean
  declare dateFormat: string
  declare timeFormat: string
  declare language: string
  declare allowedOrigins: string[]
  declare logLevel: number
  declare version: string | null
  declare buildNumber: number
  declare authLoginCustomMessage: string | null
  declare authActiveAuthMethods: string[]
  declare authOpenIDIssuerURL: string | null
  declare authOpenIDAuthorizationURL: string | null
  declare authOpenIDTokenURL: string | null
  declare authOpenIDUserInfoURL: string | null
  declare authOpenIDJwksURL: string | null
  declare authOpenIDLogoutURL: string | null
  declare authOpenIDClientID: string | null
  declare authOpenIDClientSecret: string | null
  declare authOpenIDTokenSigningAlgorithm: string
  declare authOpenIDButtonText: string
  declare authOpenIDAutoLaunch: boolean
  declare authOpenIDAutoRegister: boolean
  declare authOpenIDMatchExistingBy: string | null
  declare authOpenIDMobileRedirectURIs: string[]
  declare authOpenIDGroupClaim: string
  declare authOpenIDAdvancedPermsClaim: string
  declare authOpenIDSubfolderForRedirectURLs: string | undefined

  constructor(settings?: ServerSettingsData | null) {
    this.id = 'server-settings'
    this.tokenSecret = null

    // Scanner
    this.scannerParseSubtitle = false
    this.scannerFindCovers = false
    this.scannerCoverProvider = 'google'
    this.scannerPreferMatchedMetadata = false
    this.scannerDisableWatcher = false

    // Metadata - choose to store inside users library item folder
    this.storeCoverWithItem = false
    this.storeMetadataWithItem = false
    this.metadataFileFormat = 'json'

    // Security/Rate limits
    this.rateLimitLoginRequests = 10
    this.rateLimitLoginWindow = 10 * 60 * 1000 // 10 Minutes
    this.allowIframe = false

    // Backups
    this.backupPath = Path.join(global.MetadataPath, 'backups')
    this.backupSchedule = false // If false then auto-backups are disabled
    this.backupsToKeep = 2
    this.maxBackupSize = 1

    // Logger
    this.loggerDailyLogsToKeep = 7
    this.loggerScannerLogsToKeep = 2

    // Bookshelf Display
    this.homeBookshelfView = BookshelfView.DETAIL
    this.bookshelfView = BookshelfView.DETAIL

    // Podcasts
    this.podcastEpisodeSchedule = '0 * * * *' // Every hour

    // Sorting
    this.sortingIgnorePrefix = false
    this.sortingPrefixes = ['the', 'a']

    // Misc Flags
    this.chromecastEnabled = false
    this.dateFormat = 'MM/dd/yyyy'
    this.timeFormat = 'HH:mm'
    this.language = 'en-us'
    this.allowedOrigins = []

    this.logLevel = Logger.logLevel

    this.version = packageJson.version
    this.buildNumber = packageJson.buildNumber

    // Auth settings
    this.authLoginCustomMessage = null
    this.authActiveAuthMethods = ['local']

    // openid settings
    this.authOpenIDIssuerURL = null
    this.authOpenIDAuthorizationURL = null
    this.authOpenIDTokenURL = null
    this.authOpenIDUserInfoURL = null
    this.authOpenIDJwksURL = null
    this.authOpenIDLogoutURL = null
    this.authOpenIDClientID = null
    this.authOpenIDClientSecret = null
    this.authOpenIDTokenSigningAlgorithm = 'RS256'
    this.authOpenIDButtonText = 'Login with OpenId'
    this.authOpenIDAutoLaunch = false
    this.authOpenIDAutoRegister = false
    this.authOpenIDMatchExistingBy = null
    this.authOpenIDMobileRedirectURIs = ['audiobookshelf://oauth']
    this.authOpenIDGroupClaim = ''
    this.authOpenIDAdvancedPermsClaim = ''
    this.authOpenIDSubfolderForRedirectURLs = undefined

    if (settings) {
      this.construct(settings)
    }
  }

  construct(settings: ServerSettingsData) {
    // cast(d): tokenSecret of the stored settings may be undefined; copied as given, like the JS
    this.tokenSecret = settings.tokenSecret as string | null
    this.scannerFindCovers = !!settings.scannerFindCovers
    this.scannerCoverProvider = settings.scannerCoverProvider || 'google'
    // cast(d): scannerParseSubtitle of the stored settings may be undefined; copied as given, like the JS
    this.scannerParseSubtitle = settings.scannerParseSubtitle as boolean
    this.scannerPreferMatchedMetadata = !!settings.scannerPreferMatchedMetadata
    this.scannerDisableWatcher = !!settings.scannerDisableWatcher

    this.storeCoverWithItem = !!settings.storeCoverWithItem
    this.storeMetadataWithItem = !!settings.storeMetadataWithItem
    this.metadataFileFormat = settings.metadataFileFormat || 'json'

    // cast(d): isNaN coerces its argument (undefined is NaN)
    this.rateLimitLoginRequests = !isNaN(settings.rateLimitLoginRequests as number) ? Number(settings.rateLimitLoginRequests) : 10
    // cast(d): isNaN coerces its argument (undefined is NaN)
    this.rateLimitLoginWindow = !isNaN(settings.rateLimitLoginWindow as number) ? Number(settings.rateLimitLoginWindow) : 10 * 60 * 1000 // 10 Minutes
    this.allowIframe = !!settings.allowIframe

    this.backupPath = settings.backupPath || Path.join(global.MetadataPath, 'backups')
    this.backupSchedule = settings.backupSchedule || false
    this.backupsToKeep = settings.backupsToKeep || 2
    this.maxBackupSize = settings.maxBackupSize === 0 ? 0 : settings.maxBackupSize || 1

    this.loggerDailyLogsToKeep = settings.loggerDailyLogsToKeep || 7
    this.loggerScannerLogsToKeep = settings.loggerScannerLogsToKeep || 2

    this.homeBookshelfView = settings.homeBookshelfView || BookshelfView.STANDARD
    this.bookshelfView = settings.bookshelfView || BookshelfView.STANDARD

    this.sortingIgnorePrefix = !!settings.sortingIgnorePrefix
    this.sortingPrefixes = settings.sortingPrefixes || ['the']
    this.chromecastEnabled = !!settings.chromecastEnabled
    this.dateFormat = settings.dateFormat || 'MM/dd/yyyy'
    this.timeFormat = settings.timeFormat || 'HH:mm'
    this.language = settings.language || 'en-us'
    this.allowedOrigins = settings.allowedOrigins || []
    this.logLevel = settings.logLevel || Logger.logLevel
    this.version = settings.version || null
    this.buildNumber = settings.buildNumber || 0 // Added v2.4.5

    this.authLoginCustomMessage = sanitize(settings.authLoginCustomMessage) || null // Added v2.8.0
    this.authActiveAuthMethods = settings.authActiveAuthMethods || ['local']

    this.authOpenIDIssuerURL = settings.authOpenIDIssuerURL || null
    this.authOpenIDAuthorizationURL = settings.authOpenIDAuthorizationURL || null
    this.authOpenIDTokenURL = settings.authOpenIDTokenURL || null
    this.authOpenIDUserInfoURL = settings.authOpenIDUserInfoURL || null
    this.authOpenIDJwksURL = settings.authOpenIDJwksURL || null
    this.authOpenIDLogoutURL = settings.authOpenIDLogoutURL || null
    this.authOpenIDClientID = settings.authOpenIDClientID || null
    this.authOpenIDClientSecret = settings.authOpenIDClientSecret || null
    this.authOpenIDTokenSigningAlgorithm = settings.authOpenIDTokenSigningAlgorithm || 'RS256'
    this.authOpenIDButtonText = settings.authOpenIDButtonText || 'Login with OpenId'
    this.authOpenIDAutoLaunch = !!settings.authOpenIDAutoLaunch
    this.authOpenIDAutoRegister = !!settings.authOpenIDAutoRegister
    this.authOpenIDMatchExistingBy = settings.authOpenIDMatchExistingBy || null
    this.authOpenIDMobileRedirectURIs = settings.authOpenIDMobileRedirectURIs || ['audiobookshelf://oauth']
    this.authOpenIDGroupClaim = settings.authOpenIDGroupClaim || ''
    this.authOpenIDAdvancedPermsClaim = settings.authOpenIDAdvancedPermsClaim || ''
    this.authOpenIDSubfolderForRedirectURLs = settings.authOpenIDSubfolderForRedirectURLs

    if (!Array.isArray(this.authActiveAuthMethods)) {
      this.authActiveAuthMethods = ['local']
    }

    // remove uninitialized methods
    // OpenID
    if (this.authActiveAuthMethods.includes('openid') && !this.isOpenIDAuthSettingsValid) {
      this.authActiveAuthMethods.splice(this.authActiveAuthMethods.indexOf('openid', 0), 1)
    }

    // fallback to local
    if (!Array.isArray(this.authActiveAuthMethods) || this.authActiveAuthMethods.length == 0) {
      this.authActiveAuthMethods = ['local']
    }

    // Migrations
    if (settings.storeCoverWithBook != undefined) {
      // storeCoverWithBook was renamed to storeCoverWithItem in 2.0.0
      this.storeCoverWithItem = !!settings.storeCoverWithBook
    }
    if (settings.storeMetadataWithBook != undefined) {
      // storeMetadataWithBook was renamed to storeMetadataWithItem in 2.0.0
      this.storeMetadataWithItem = !!settings.storeMetadataWithBook
    }
    if (settings.homeBookshelfView == undefined) {
      // homeBookshelfView was added in 2.1.3
      // cast(d): bookshelfView of the stored settings may be undefined; copied as given, like the JS
      this.homeBookshelfView = settings.bookshelfView as number
    }
    if (settings.metadataFileFormat == undefined) {
      // metadataFileFormat was added in 2.2.21
      // All users using old settings will stay abs until changed
      this.metadataFileFormat = 'abs'
    }

    // As of v2.4.5 only json is supported
    if (this.metadataFileFormat !== 'json') {
      Logger.warn(`[ServerSettings] Invalid metadataFileFormat ${this.metadataFileFormat} (as of v2.4.5 only json is supported)`)
      this.metadataFileFormat = 'json'
    }

    if (this.logLevel !== Logger.logLevel) {
      Logger.setLogLevel(this.logLevel)
    }

    if (process.env.BACKUP_PATH && this.backupPath !== process.env.BACKUP_PATH) {
      Logger.info(`[ServerSettings] Using backup path from environment variable ${process.env.BACKUP_PATH}`)
      this.backupPath = process.env.BACKUP_PATH
    }

    if (process.env.ALLOW_IFRAME === '1' && !this.allowIframe) {
      Logger.info(`[ServerSettings] Using allowIframe from environment variable`)
      this.allowIframe = true
    }
  }

  toJSON() {
    // Use toJSONForBrowser if sending to client
    return {
      id: this.id,
      tokenSecret: this.tokenSecret, // Do not return to client
      scannerFindCovers: this.scannerFindCovers,
      scannerCoverProvider: this.scannerCoverProvider,
      scannerParseSubtitle: this.scannerParseSubtitle,
      scannerPreferMatchedMetadata: this.scannerPreferMatchedMetadata,
      scannerDisableWatcher: this.scannerDisableWatcher,
      storeCoverWithItem: this.storeCoverWithItem,
      storeMetadataWithItem: this.storeMetadataWithItem,
      metadataFileFormat: this.metadataFileFormat,
      rateLimitLoginRequests: this.rateLimitLoginRequests,
      rateLimitLoginWindow: this.rateLimitLoginWindow,
      allowIframe: this.allowIframe,
      backupPath: this.backupPath,
      backupSchedule: this.backupSchedule,
      backupsToKeep: this.backupsToKeep,
      maxBackupSize: this.maxBackupSize,
      loggerDailyLogsToKeep: this.loggerDailyLogsToKeep,
      loggerScannerLogsToKeep: this.loggerScannerLogsToKeep,
      homeBookshelfView: this.homeBookshelfView,
      bookshelfView: this.bookshelfView,
      podcastEpisodeSchedule: this.podcastEpisodeSchedule,
      sortingIgnorePrefix: this.sortingIgnorePrefix,
      sortingPrefixes: [...this.sortingPrefixes],
      chromecastEnabled: this.chromecastEnabled,
      dateFormat: this.dateFormat,
      timeFormat: this.timeFormat,
      language: this.language,
      allowedOrigins: this.allowedOrigins,
      logLevel: this.logLevel,
      version: this.version,
      buildNumber: this.buildNumber,
      authLoginCustomMessage: this.authLoginCustomMessage,
      authActiveAuthMethods: this.authActiveAuthMethods,
      authOpenIDIssuerURL: this.authOpenIDIssuerURL,
      authOpenIDAuthorizationURL: this.authOpenIDAuthorizationURL,
      authOpenIDTokenURL: this.authOpenIDTokenURL,
      authOpenIDUserInfoURL: this.authOpenIDUserInfoURL,
      authOpenIDJwksURL: this.authOpenIDJwksURL,
      authOpenIDLogoutURL: this.authOpenIDLogoutURL,
      authOpenIDClientID: this.authOpenIDClientID, // Do not return to client
      authOpenIDClientSecret: this.authOpenIDClientSecret, // Do not return to client
      authOpenIDTokenSigningAlgorithm: this.authOpenIDTokenSigningAlgorithm,
      authOpenIDButtonText: this.authOpenIDButtonText,
      authOpenIDAutoLaunch: this.authOpenIDAutoLaunch,
      authOpenIDAutoRegister: this.authOpenIDAutoRegister,
      authOpenIDMatchExistingBy: this.authOpenIDMatchExistingBy,
      authOpenIDMobileRedirectURIs: this.authOpenIDMobileRedirectURIs, // Do not return to client
      authOpenIDGroupClaim: this.authOpenIDGroupClaim, // Do not return to client
      authOpenIDAdvancedPermsClaim: this.authOpenIDAdvancedPermsClaim, // Do not return to client
      authOpenIDSubfolderForRedirectURLs: this.authOpenIDSubfolderForRedirectURLs
    }
  }

  /**
   * Host timezone used by cron schedulers (not persisted in settings)
   * @returns IANA timezone name, e.g. "America/New_York"
   */
  static getHostTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }

  toJSONForBrowser() {
    const json: Partial<ServerSettingsJSON> & { timeZone?: string } = this.toJSON()
    delete json.tokenSecret
    delete json.authOpenIDClientID
    delete json.authOpenIDClientSecret
    delete json.authOpenIDMobileRedirectURIs
    delete json.authOpenIDGroupClaim
    delete json.authOpenIDAdvancedPermsClaim
    json.timeZone = ServerSettings.getHostTimeZone()
    return json
  }

  get supportedAuthMethods() {
    return ['local', 'openid']
  }

  /**
   * Auth settings required for openid to be valid
   */
  get isOpenIDAuthSettingsValid() {
    return this.authOpenIDIssuerURL && this.authOpenIDAuthorizationURL && this.authOpenIDTokenURL && this.authOpenIDUserInfoURL && this.authOpenIDJwksURL && this.authOpenIDClientID && this.authOpenIDClientSecret && this.authOpenIDTokenSigningAlgorithm
  }

  get authenticationSettings() {
    return {
      authLoginCustomMessage: this.authLoginCustomMessage,
      authActiveAuthMethods: this.authActiveAuthMethods,
      authOpenIDIssuerURL: this.authOpenIDIssuerURL,
      authOpenIDAuthorizationURL: this.authOpenIDAuthorizationURL,
      authOpenIDTokenURL: this.authOpenIDTokenURL,
      authOpenIDUserInfoURL: this.authOpenIDUserInfoURL,
      authOpenIDJwksURL: this.authOpenIDJwksURL,
      authOpenIDLogoutURL: this.authOpenIDLogoutURL,
      authOpenIDClientID: this.authOpenIDClientID, // Do not return to client
      authOpenIDClientSecret: this.authOpenIDClientSecret, // Do not return to client
      authOpenIDTokenSigningAlgorithm: this.authOpenIDTokenSigningAlgorithm,
      authOpenIDButtonText: this.authOpenIDButtonText,
      authOpenIDAutoLaunch: this.authOpenIDAutoLaunch,
      authOpenIDAutoRegister: this.authOpenIDAutoRegister,
      authOpenIDMatchExistingBy: this.authOpenIDMatchExistingBy,
      authOpenIDMobileRedirectURIs: this.authOpenIDMobileRedirectURIs, // Do not return to client
      authOpenIDGroupClaim: this.authOpenIDGroupClaim, // Do not return to client
      authOpenIDAdvancedPermsClaim: this.authOpenIDAdvancedPermsClaim, // Do not return to client
      authOpenIDSubfolderForRedirectURLs: this.authOpenIDSubfolderForRedirectURLs,

      authOpenIDSamplePermissions: User.getSampleAbsPermissions()
    }
  }

  get authFormData() {
    const clientFormData: { authLoginCustomMessage: string; authOpenIDButtonText?: string; authOpenIDAutoLaunch?: boolean } = {
      authLoginCustomMessage: sanitize(this.authLoginCustomMessage)
    }
    if (this.authActiveAuthMethods.includes('openid')) {
      clientFormData.authOpenIDButtonText = this.authOpenIDButtonText
      clientFormData.authOpenIDAutoLaunch = this.authOpenIDAutoLaunch
    }
    return clientFormData
  }

  /**
   * Update server settings
   *
   * @param payload
   * @returns true if updates were made
   */
  update(payload: Record<string, unknown>) {
    // cast(d): this object is read and written by key in the loop below (same object)
    const self = this as unknown as Record<string, unknown>
    let hasUpdates = false
    for (const key in payload) {
      if (!PATCHABLE_SETTINGS_KEYS.has(key)) continue

      if (self[key] !== payload[key]) {
        if (key === 'logLevel') {
          // cast(d): the patch payload is not validated; the client sends the log level as a number
          Logger.setLogLevel(payload[key] as number)
        }
        self[key] = payload[key]
        hasUpdates = true
      }
    }
    return hasUpdates
  }
}
export = ServerSettings
