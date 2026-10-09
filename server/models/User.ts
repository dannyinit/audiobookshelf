import uuid = require('uuid')
import sequelize = require('sequelize')
import type { Attributes, CreationAttributes, CreationOptional, Includeable, InferAttributes, InferCreationAttributes, InitOptions, InstanceDestroyOptions, InstanceUpdateOptions, ModelAttributes, ModelStatic, NonAttribute, SaveOptions, Utils } from 'sequelize'
import lruCache = require('lru-cache')

import Logger = require('../Logger')
import SocketAuthority = require('../SocketAuthority')
import utils = require('../utils')
import TokenManager = require('../auth/TokenManager')
import type Auth = require('../Auth')
import type OldPlaybackSession = require('../objects/PlaybackSession')
import type Book = require('./Book')
import type LibraryItem = require('./LibraryItem')
import type MediaProgress = require('./MediaProgress')
import type { AudioBookmarkObject, MediaProgressExtraData, ModelsSequelize, UpdateValues, UserExtraData, UserPermissions } from './types'
const uuidv4 = uuid.v4
const { LRUCache } = lruCache
const { isNullOrNaN } = utils

class UserCache {
  declare cache: lruCache.LRUCache<string, User>

  constructor() {
    this.cache = new LRUCache({ max: 100 })
  }

  getById(id: string) {
    const user = this.cache.get(id)
    return user
  }

  getByEmail(email: string) {
    const user = this.cache.find((u) => u.email === email)
    return user
  }

  getByUsername(username: string) {
    const user = this.cache.find((u) => u.username === username)
    return user
  }

  getByOldId(oldUserId: string) {
    const user = this.cache.find((u) => u.extraData?.oldUserId === oldUserId)
    return user
  }

  getByOpenIDSub(sub: string) {
    const user = this.cache.find((u) => u.extraData?.authOpenIDSub === sub)
    return user
  }

  set(user: User) {
    user.fromCache = true
    this.cache.set(user.id, user)
  }

  delete(userId: string) {
    this.cache.delete(userId)
  }

  maybeInvalidate(user: User) {
    if (!user.fromCache) this.delete(user.id)
  }
}

const userCache = new UserCache()

const { DataTypes, Model } = sequelize

interface ProgressUpdatePayloadObject {
  libraryItemId: string
  /** null for a book (playback sessions pass their episodeId) */
  episodeId?: string | null
  /** null from a playback session without a duration (read with isNullOrNaN) */
  duration?: number | null
  progress?: number
  currentTime?: number
  isFinished?: boolean
  hideFromContinueListening?: boolean
  ebookLocation?: string
  ebookProgress?: number
  finishedAt?: string
  /** null from a playback session without updatedAt (only a truthy value is used) */
  lastUpdate?: number | null
  /** From the library settings, which store null when not set */
  markAsFinishedTimeRemaining?: number | null
  /** From the library settings, which store null when not set */
  markAsFinishedPercentComplete?: number | null
  /** Sent by clients syncing local progress (read when the progress is created) */
  createdAt?: number
}

/**
 * OpenID userinfo claims read when matching or creating a user
 */
interface OpenIdUserInfo {
  sub: string
  email?: string
  email_verified?: boolean
  preferred_username?: string
  username?: string
  name?: string
}

/**
 * Permissions JSON from the OpenID advanced permissions claim: the keys of User.permissionMapping, not validated yet
 */
type AbsPermissionsPayload = Record<string, unknown> & {
  allowedLibraries?: string[]
  allowedTags?: string[]
}

type UserAttributes = InferAttributes<User>

/**
 * User JSON for the browser (see toOldJSONForBrowser); mediaProgress and bookmarks are left out when minimal
 */
interface UserJSONForBrowser {
  id: string
  username: string
  email: string | null
  type: string
  token: string | null
  isOldToken: boolean | undefined
  mediaProgress?: ReturnType<MediaProgress['getOldMediaProgress']>[]
  seriesHideFromContinueListening: string[]
  bookmarks?: AudioBookmarkObject[]
  isActive: boolean
  isLocked: boolean
  lastSeen: number | null
  createdAt: number
  permissions: UserPermissions
  librariesAccessible: string[]
  itemTagsSelected: string[]
  hasOpenIDLink: boolean
}

class User extends Model<UserAttributes, InferCreationAttributes<User>> {
  declare id: string
  declare username: string
  declare email: string | null
  declare pash: string | null
  declare type: string
  declare token: string | null
  declare isActive: boolean
  declare isLocked: CreationOptional<boolean>
  declare lastSeen: CreationOptional<Date | null>
  declare permissions: UserPermissions
  declare bookmarks: AudioBookmarkObject[]
  declare extraData: UserExtraData | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize
  declare static readonly sequelize: ModelsSequelize

  /** Set on users held in the user cache */
  declare fromCache?: NonAttribute<boolean>
  /** Temporary flag not saved in db that is set in Auth.js jwtAuthCheck */
  declare isOldToken?: NonAttribute<boolean>

  // Expanded properties

  /** Only included when extended */
  declare mediaProgresses: NonAttribute<MediaProgress[]>

  // Excludes "root" since their can only be 1 root user
  static accountTypes = ['admin', 'user', 'guest']

  /**
   * List of expected permission properties from the client
   * Only used for OpenID
   */
  static permissionMapping: Record<string, keyof UserPermissions> = {
    canDownload: 'download',
    canUpload: 'upload',
    canDelete: 'delete',
    canUpdate: 'update',
    canAccessExplicitContent: 'accessExplicitContent',
    canAccessAllLibraries: 'accessAllLibraries',
    canAccessAllTags: 'accessAllTags',
    canCreateEReader: 'createEreader',
    tagsAreDenylist: 'selectedTagsNotAccessible',
    // Direct mapping for array-based permissions
    allowedLibraries: 'librariesAccessible',
    allowedTags: 'itemTagsSelected'
  }

  /**
   * Get a sample to show how a JSON for updatePermissionsFromExternalJSON should look like
   * Only used for OpenID
   *
   * @returns JSON string
   */
  static getSampleAbsPermissions(): string {
    // Start with a template object where all permissions are false for simplicity
    const samplePermissions = Object.keys(User.permissionMapping).reduce<Record<string, string[] | boolean>>((acc, key) => {
      // For array-based permissions, provide a sample array
      if (key === 'allowedLibraries') {
        acc[key] = [`5406ba8a-16e1-451d-96d7-4931b0a0d966`, `918fd848-7c1d-4a02-818a-847435a879ca`]
      } else if (key === 'allowedTags') {
        acc[key] = [`ExampleTag`, `AnotherTag`, `ThirdTag`]
      } else {
        acc[key] = false
      }
      return acc
    }, {})

    return JSON.stringify(samplePermissions, null, 2) // Pretty print the JSON
  }

  static getDefaultPermissionsForUserType(type: string) {
    return {
      download: true,
      update: type === 'root' || type === 'admin',
      delete: type === 'root',
      upload: type === 'root' || type === 'admin',
      createEreader: type === 'root' || type === 'admin',
      accessAllLibraries: true,
      accessAllTags: true,
      accessExplicitContent: type === 'root' || type === 'admin',
      selectedTagsNotAccessible: false,
      librariesAccessible: [],
      itemTagsSelected: []
    }
  }

  /**
   * Create root user
   */
  static async createRootUser(username: string, pash: string, auth: Auth): Promise<User> {
    const userId = uuidv4()

    const token = auth.generateAccessToken({ id: userId, username })

    const newUser = {
      id: userId,
      type: 'root',
      username,
      pash,
      token,
      isActive: true,
      permissions: this.getDefaultPermissionsForUserType('root'),
      bookmarks: [],
      extraData: {
        seriesHideFromContinueListening: []
      }
    }
    return this.create(newUser)
  }

  /**
   * Finds an existing user by OpenID subject identifier, or by email/username based on server settings
   * Returns null if no user is found
   */
  static async findUserFromOpenIdUserInfo(userinfo: OpenIdUserInfo): Promise<User | { error: string } | null> {
    let user = await this.getUserByOpenIDSub(userinfo.sub)

    // Matched by sub
    if (user) {
      Logger.debug(`[User] openid: User found by sub "${userinfo.sub}"`)
      return user
    }

    // Match existing user by email
    if (global.ServerSettings.authOpenIDMatchExistingBy === 'email') {
      if (userinfo.email) {
        // Only disallow when email_verified explicitly set to false (allow both if not set or true)
        if (userinfo.email_verified === false) {
          Logger.warn(`[User] openid: User not found and email "${userinfo.email}" is not verified`)
          return {
            error: 'Email not verified'
          }
        } else {
          Logger.info(`[User] openid: User not found, checking existing with email "${userinfo.email}"`)
          user = await this.getUserByEmail(userinfo.email)

          if (user?.authOpenIDSub) {
            Logger.warn(`[User] openid: User found with email "${userinfo.email}" but is already matched with sub "${user.authOpenIDSub}"`)
            // User is linked to a different OpenID subject; do not proceed.
            return {
              error: 'User already linked to a different OpenID subject'
            }
          }
        }
      } else {
        Logger.warn(`[User] openid: User not found and no email in userinfo`)
        // We deny login, because if the admin whishes to match email, it makes sense to require it
        return {
          error: 'No email in userinfo'
        }
      }
    }
    // Match existing user by username
    else if (global.ServerSettings.authOpenIDMatchExistingBy === 'username') {
      let username

      if (userinfo.preferred_username) {
        Logger.info(`[User] openid: User not found, checking existing with userinfo.preferred_username "${userinfo.preferred_username}"`)
        username = userinfo.preferred_username
      } else if (userinfo.username) {
        Logger.info(`[User] openid: User not found, checking existing with userinfo.username "${userinfo.username}"`)
        username = userinfo.username
      } else {
        Logger.warn(`[User] openid: User not found and neither preferred_username nor username in userinfo`)
        return {
          error: 'No username in userinfo'
        }
      }

      user = await this.getUserByUsername(username)

      if (user?.authOpenIDSub) {
        Logger.warn(`[User] openid: User found with username "${username}" but is already matched with sub "${user.authOpenIDSub}"`)
        // User is linked to a different OpenID subject; do not proceed.
        return {
          error: 'User already linked to a different OpenID subject'
        }
      }
    }

    if (!user) {
      return null
    }

    // Found existing user via email or username
    if (!user.isActive) {
      Logger.warn(`[User] openid: User found but is not active`)
      return user
    }

    // Update user with OpenID sub
    if (!user.extraData) user.extraData = {}
    user.extraData.authOpenIDSub = userinfo.sub
    user.changed('extraData', true)
    await user.save()

    Logger.debug(`[User] openid: User found by email/username`)
    return user
  }

  /**
   * Create user from openid userinfo
   */
  static async createUserFromOpenIdUserInfo(userinfo: OpenIdUserInfo & { name?: string }): Promise<User | null> {
    const userId = uuidv4()
    // TODO: Ensure username is unique?
    const username = userinfo.preferred_username || userinfo.name || userinfo.sub
    const email = userinfo.email && userinfo.email_verified ? userinfo.email : null

    const token = TokenManager.generateAccessToken({ id: userId, username })

    const newUser = {
      id: userId,
      type: 'user',
      username,
      email,
      pash: null,
      token,
      isActive: true,
      permissions: this.getDefaultPermissionsForUserType('user'),
      bookmarks: [],
      extraData: {
        authOpenIDSub: userinfo.sub,
        seriesHideFromContinueListening: []
      }
    }
    const user = await this.create(newUser)

    if (user) {
      SocketAuthority.adminEmitter('user_added', user.toOldJSONForBrowser())
      return user
    }
    return null
  }

  /**
   * Get user by username case insensitive
   */
  static async getUserByUsername(username: string): Promise<User | null> {
    if (!username) return null

    const cachedUser = userCache.getByUsername(username)
    if (cachedUser) return cachedUser

    const user = await this.findOne({
      where: sequelize.where(sequelize.fn('lower', sequelize.col('username')), username.toLowerCase()),
      include: this.sequelize.models.mediaProgress
    })

    if (user) userCache.set(user)

    return user
  }

  /**
   * Get user by email case insensitive
   */
  static async getUserByEmail(email: string): Promise<User | null> {
    if (!email) return null

    const cachedUser = userCache.getByEmail(email)
    if (cachedUser) return cachedUser

    const user = await this.findOne({
      where: sequelize.where(sequelize.fn('lower', sequelize.col('email')), email.toLowerCase()),
      include: this.sequelize.models.mediaProgress
    })

    if (user) userCache.set(user)

    return user
  }

  /**
   * Get user by id
   */
  static async getUserById(userId: string): Promise<User | null> {
    if (!userId) return null

    const cachedUser = userCache.getById(userId)
    if (cachedUser) return cachedUser

    const user = await this.findByPk(userId, {
      include: this.sequelize.models.mediaProgress
    })

    if (user) userCache.set(user)

    return user
  }

  /**
   * Get user by id or old id
   * JWT tokens generated before 2.3.0 used old user ids
   */
  static async getUserByIdOrOldId(userId: string): Promise<User | null> {
    if (!userId) return null
    const cachedUser = userCache.getById(userId) || userCache.getByOldId(userId)
    if (cachedUser) return cachedUser

    const user = await this.findOne({
      where: {
        [sequelize.Op.or]: [{ id: userId }, { 'extraData.oldUserId': userId }]
      },
      include: this.sequelize.models.mediaProgress
    })

    if (user) userCache.set(user)

    return user
  }

  /**
   * Get user by openid sub
   */
  static async getUserByOpenIDSub(sub: string): Promise<User | null> {
    if (!sub) return null

    const cachedUser = userCache.getByOpenIDSub(sub)
    if (cachedUser) return cachedUser

    const user = await this.findOne({
      where: sequelize.where(sequelize.literal(`extraData->>"authOpenIDSub"`), sub),
      include: this.sequelize.models.mediaProgress
    })

    if (user) userCache.set(user)

    return user
  }

  /**
   * Get array of user id and username
   * @returns { id, username }
   */
  static async getMinifiedUserObjects(): Promise<{ id: string; username: string }[]> {
    const users = await this.findAll({
      attributes: ['id', 'username']
    })
    return users.map((u) => {
      return {
        id: u.id,
        username: u.username
      }
    })
  }

  /**
   * Return true if root user exists
   */
  static async getHasRootUser(): Promise<boolean> {
    const count = await this.count({
      where: {
        type: 'root'
      }
    })
    return count > 0
  }

  /**
   * Check if user exists with username
   */
  static async checkUserExistsWithUsername(username: string): Promise<boolean> {
    const count = await this.count({
      where: {
        username
      }
    })
    return count > 0
  }

  static mediaProgressRemoved(mediaProgress: MediaProgress) {
    const cachedUser = userCache.getById(mediaProgress.userId)
    if (cachedUser) {
      Logger.debug(`[User] mediaProgressRemoved: ${mediaProgress.id} from user ${cachedUser.id}`)
      cachedUser.mediaProgresses = cachedUser.mediaProgresses.filter((mp) => mp.id !== mediaProgress.id)
    }
  }

  /**
   * Initialize model
   */
  static init(sequelize: ModelsSequelize): void
  // Model.init signature, only declared so the class stays assignable to Model (Database calls init(sequelize))
  static init<MS extends ModelStatic<sequelize.Model>, M extends InstanceType<MS>>(this: MS, attributes: ModelAttributes<M, Attributes<M>> | ModelsSequelize, options?: InitOptions<M>): MS
  static init(sequelize: ModelsSequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        username: DataTypes.STRING,
        email: DataTypes.STRING,
        pash: DataTypes.STRING,
        type: DataTypes.STRING,
        token: DataTypes.STRING,
        isActive: {
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },
        isLocked: {
          type: DataTypes.BOOLEAN,
          defaultValue: false
        },
        lastSeen: DataTypes.DATE,
        permissions: DataTypes.JSON,
        bookmarks: DataTypes.JSON,
        extraData: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'user',
        hooks: {
          beforeDestroy(user) {
            // cast(b): the hook receives the User instance; init types the hook instances as Model
            if ((user as User).type === 'root') {
              throw new Error('Root user cannot be deleted')
            }
          }
        }
      }
    )
  }

  get isRoot(): NonAttribute<boolean> {
    return this.type === 'root'
  }
  get isAdminOrUp(): NonAttribute<boolean> {
    return this.isRoot || this.type === 'admin'
  }
  get isUser(): NonAttribute<boolean> {
    return this.type === 'user'
  }
  get isGuest(): NonAttribute<boolean> {
    return this.type === 'guest'
  }
  get canAccessExplicitContent(): NonAttribute<boolean> {
    return !!this.permissions?.accessExplicitContent && this.isActive
  }
  get canDelete(): NonAttribute<boolean> {
    return !!this.permissions?.delete && this.isActive
  }
  get canUpdate(): NonAttribute<boolean> {
    return !!this.permissions?.update && this.isActive
  }
  get canDownload(): NonAttribute<boolean> {
    return !!this.permissions?.download && this.isActive
  }
  get canUpload(): NonAttribute<boolean> {
    return !!this.permissions?.upload && this.isActive
  }
  get authOpenIDSub(): NonAttribute<string | null> {
    return this.extraData?.authOpenIDSub || null
  }

  /**
   * User data for clients
   * Emitted on socket events user_online, user_offline and user_stream_update
   */
  toJSONForPublic(sessions: OldPlaybackSession[]) {
    const session = sessions?.find((s) => s.userId === this.id)?.toJSONForClient() || null
    return {
      id: this.id,
      username: this.username,
      type: this.type,
      session,
      lastSeen: this.lastSeen?.valueOf() || null,
      createdAt: this.createdAt.valueOf()
    }
  }

  /**
   * User data for browser using old model
   *
   * @param [hideRootToken=false]
   * @param [minimal=false]
   */
  toOldJSONForBrowser(hideRootToken = false, minimal = false): UserJSONForBrowser {
    const seriesHideFromContinueListening = this.extraData?.seriesHideFromContinueListening || []
    const librariesAccessible = this.permissions?.librariesAccessible || []
    const itemTagsSelected = this.permissions?.itemTagsSelected || []
    const permissions = { ...this.permissions }
    delete permissions.librariesAccessible
    delete permissions.itemTagsSelected

    const json: UserJSONForBrowser = {
      id: this.id,
      username: this.username,
      email: this.email,
      type: this.type,
      // TODO: Old non-expiring token
      token: this.type === 'root' && hideRootToken ? '' : this.token,
      // TODO: Temporary flag not saved in db that is set in Auth.js jwtAuthCheck
      // Necessary to detect apps using old tokens that no longer match the old token stored on the user
      isOldToken: this.isOldToken,
      mediaProgress: this.mediaProgresses?.map((mp) => mp.getOldMediaProgress()) || [],
      seriesHideFromContinueListening: [...seriesHideFromContinueListening],
      bookmarks: this.bookmarks?.map((b) => ({ ...b })) || [],
      isActive: this.isActive,
      isLocked: this.isLocked,
      lastSeen: this.lastSeen?.valueOf() || null,
      createdAt: this.createdAt.valueOf(),
      permissions: permissions,
      librariesAccessible: [...librariesAccessible],
      itemTagsSelected: [...itemTagsSelected],
      hasOpenIDLink: !!this.authOpenIDSub
    }
    if (minimal) {
      delete json.mediaProgress
      delete json.bookmarks
    }
    return json
  }

  /**
   * Check user has access to library
   */
  checkCanAccessLibrary(libraryId: string): boolean {
    if (this.permissions?.accessAllLibraries) return true
    if (!this.permissions?.librariesAccessible) return false
    return this.permissions.librariesAccessible.includes(libraryId)
  }

  /**
   * Check user has access to library item with tags
   */
  checkCanAccessLibraryItemWithTags(tags: string[]): boolean {
    if (this.permissions.accessAllTags) return true
    const itemTagsSelected = this.permissions?.itemTagsSelected || []
    if (this.permissions.selectedTagsNotAccessible) {
      if (!tags?.length) return true
      return tags.every((tag) => !itemTagsSelected?.includes(tag))
    }
    if (!tags?.length) return false
    return itemTagsSelected.some((tag) => tags.includes(tag))
  }

  /**
   * Check user can access library item
   */
  checkCanAccessLibraryItem(libraryItem: LibraryItem): boolean {
    if (!this.checkCanAccessLibrary(libraryItem.libraryId)) return false

    // NOTE: neither Book nor Podcast has a metadata property (the old models had one), so the second check is always false
    // cast(c): the JS reads media.metadata; see the NOTE above
    const libraryItemExplicit = !!libraryItem.media.explicit || !!(libraryItem.media as { metadata?: { explicit?: boolean } }).metadata?.explicit

    if (libraryItemExplicit && !this.canAccessExplicitContent) return false

    return this.checkCanAccessLibraryItemWithTags(libraryItem.media.tags)
  }

  /**
   * Get first available library id for user
   *
   * @param libraryIds
   */
  getDefaultLibraryId(libraryIds: string[]): string | null {
    // Libraries should already be in ascending display order, find first accessible
    return libraryIds.find((lid) => this.checkCanAccessLibrary(lid)) || null
  }

  /**
   * Get media progress by media item id
   */
  getMediaProgress(mediaItemId: string): MediaProgress | null | undefined {
    if (!this.mediaProgresses?.length) return null
    return this.mediaProgresses.find((mp) => mp.mediaItemId === mediaItemId)
  }

  /**
   * Get old media progress
   * TODO: Update to new model
   *
   * @param [episodeId]
   */
  getOldMediaProgress(libraryItemId: string, episodeId: string | null = null) {
    const mediaProgress = this.mediaProgresses?.find((mp) => {
      if (episodeId && mp.mediaItemId !== episodeId) return false
      return mp.extraData?.libraryItemId === libraryItemId
    })
    return mediaProgress?.getOldMediaProgress() || null
  }

  /**
   * TODO: Uses old model and should account for the different between ebook/audiobook progress
   */
  async createUpdateMediaProgressFromPayload(progressPayload: ProgressUpdatePayloadObject): Promise<{ mediaProgress?: MediaProgress; error?: string; statusCode?: number }> {
    let mediaProgress: MediaProgress | null | undefined = null
    let mediaItemId = null
    let podcastId = null
    if (progressPayload.episodeId) {
      const podcastEpisode = await this.sequelize.models.podcastEpisode.findByPk(progressPayload.episodeId, {
        attributes: ['id', 'podcastId'],
        include: [
          {
            model: this.sequelize.models.mediaProgress,
            where: { userId: this.id },
            required: false
          },
          {
            model: this.sequelize.models.podcast,
            attributes: ['id', 'title'],
            include: {
              model: this.sequelize.models.libraryItem,
              attributes: ['id']
            }
          }
          // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
        ] as unknown as Includeable[]
      })
      if (!podcastEpisode) {
        Logger.error(`[User] createUpdateMediaProgress: episode ${progressPayload.episodeId} not found`)
        return {
          error: 'Episode not found',
          statusCode: 404
        }
      }
      mediaItemId = podcastEpisode.id
      mediaProgress = podcastEpisode.mediaProgresses?.[0]
      podcastId = podcastEpisode.podcastId
    } else {
      const libraryItem = await this.sequelize.models.libraryItem.findByPk(progressPayload.libraryItemId, {
        attributes: ['id', 'mediaId', 'mediaType'],
        include: {
          model: this.sequelize.models.book,
          attributes: ['id', 'title'],
          required: false,
          include: {
            model: this.sequelize.models.mediaProgress,
            where: { userId: this.id },
            required: false
          }
          // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
        } as unknown as Includeable
      })
      if (!libraryItem) {
        Logger.error(`[User] createUpdateMediaProgress: library item ${progressPayload.libraryItemId} not found`)
        return {
          error: 'Library item not found',
          statusCode: 404
        }
      } else if (libraryItem.mediaType !== 'book') {
        Logger.error(`[User] createUpdateMediaProgress: library item ${progressPayload.libraryItemId} is not a book`)
        return {
          error: 'Library item is not a book',
          statusCode: 400
        }
      }

      mediaItemId = libraryItem.media.id
      // cast(d): media is the included Book (mediaType is "book", checked above)
      mediaProgress = (libraryItem.media as Book).mediaProgresses?.[0]
    }

    if (mediaProgress) {
      mediaProgress = await mediaProgress.applyProgressUpdate(progressPayload)
      // Same value as mediaProgress, which the callback below reads
      const updatedMediaProgress = mediaProgress
      this.mediaProgresses = this.mediaProgresses.map((mp) => (mp.id === updatedMediaProgress.id ? updatedMediaProgress : mp))
    } else {
      const newMediaProgressPayload: CreationAttributes<MediaProgress> & { extraData: MediaProgressExtraData } = {
        userId: this.id,
        mediaItemId,
        podcastId,
        mediaItemType: progressPayload.episodeId ? 'podcastEpisode' : 'book',
        duration: isNullOrNaN(progressPayload.duration) ? 0 : Number(progressPayload.duration),
        currentTime: isNullOrNaN(progressPayload.currentTime) ? 0 : Number(progressPayload.currentTime),
        isFinished: !!progressPayload.isFinished,
        hideFromContinueListening: !!progressPayload.hideFromContinueListening,
        ebookLocation: progressPayload.ebookLocation || null,
        ebookProgress: isNullOrNaN(progressPayload.ebookProgress) ? 0 : Number(progressPayload.ebookProgress),
        finishedAt: progressPayload.finishedAt || null,
        createdAt: progressPayload.createdAt || new Date(),
        extraData: {
          libraryItemId: progressPayload.libraryItemId,
          progress: isNullOrNaN(progressPayload.progress) ? 0 : Number(progressPayload.progress)
        }
      }
      if (newMediaProgressPayload.isFinished) {
        newMediaProgressPayload.finishedAt = newMediaProgressPayload.finishedAt || new Date()
        newMediaProgressPayload.extraData.progress = 1
      } else {
        newMediaProgressPayload.finishedAt = null
      }
      mediaProgress = await this.sequelize.models.mediaProgress.create(newMediaProgressPayload)
      this.mediaProgresses.push(mediaProgress)
    }
    userCache.maybeInvalidate(this)
    return {
      mediaProgress
    }
  }

  /**
   * Find bookmark
   * TODO: Bookmarks should use mediaItemId instead of libraryItemId to support podcast episodes
   */
  findBookmark(libraryItemId: string, time: number): AudioBookmarkObject | undefined {
    return this.bookmarks.find((bm) => bm.libraryItemId === libraryItemId && bm.time == time)
  }

  /**
   * Create bookmark
   */
  async createBookmark(libraryItemId: string, time: number, title: string): Promise<AudioBookmarkObject> {
    const existingBookmark = this.findBookmark(libraryItemId, time)
    if (existingBookmark) {
      Logger.warn('[User] Create Bookmark already exists for this time')
      if (existingBookmark.title !== title) {
        existingBookmark.title = title
        this.changed('bookmarks', true)
        await this.save()
      }
      return existingBookmark
    }

    const newBookmark = {
      libraryItemId,
      time,
      title,
      createdAt: Date.now()
    }
    this.bookmarks.push(newBookmark)
    this.changed('bookmarks', true)
    await this.save()
    return newBookmark
  }

  /**
   * Update bookmark
   */
  async updateBookmark(libraryItemId: string, time: number, title: string): Promise<AudioBookmarkObject | null> {
    const bookmark = this.findBookmark(libraryItemId, time)
    if (!bookmark) {
      Logger.error(`[User] updateBookmark not found`)
      return null
    }
    bookmark.title = title
    this.changed('bookmarks', true)
    await this.save()
    return bookmark
  }

  /**
   * Remove bookmark
   *
   * @returns true if bookmark was removed
   */
  async removeBookmark(libraryItemId: string, time: number): Promise<boolean> {
    if (!this.findBookmark(libraryItemId, time)) {
      Logger.error(`[User] removeBookmark not found`)
      return false
    }
    this.bookmarks = this.bookmarks.filter((bm) => bm.libraryItemId !== libraryItemId || bm.time !== time)
    this.changed('bookmarks', true)
    await this.save()
    return true
  }

  async addSeriesToHideFromContinueListening(seriesId: string): Promise<boolean> {
    if (!this.extraData) this.extraData = {}
    const seriesHideFromContinueListening = this.extraData.seriesHideFromContinueListening || []
    if (seriesHideFromContinueListening.includes(seriesId)) return false
    seriesHideFromContinueListening.push(seriesId)
    this.extraData.seriesHideFromContinueListening = seriesHideFromContinueListening
    this.changed('extraData', true)
    await this.save()
    return true
  }

  async removeSeriesFromHideFromContinueListening(seriesId: string): Promise<boolean> {
    if (!this.extraData) this.extraData = {}
    let seriesHideFromContinueListening = this.extraData.seriesHideFromContinueListening || []
    if (!seriesHideFromContinueListening.includes(seriesId)) return false
    seriesHideFromContinueListening = seriesHideFromContinueListening.filter((sid) => sid !== seriesId)
    this.extraData.seriesHideFromContinueListening = seriesHideFromContinueListening
    this.changed('extraData', true)
    await this.save()
    return true
  }

  /**
   * Update user permissions from external JSON
   *
   * @param absPermissions JSON containing user permissions
   * @returns true if updates were made
   */
  async updatePermissionsFromExternalJSON(absPermissions: AbsPermissionsPayload): Promise<boolean> {
    if (!this.permissions) this.permissions = {}
    let hasUpdates = false

    // Same object as this.permissions, read and written by key
    const permissionValues: Record<string, unknown> = this.permissions
    // Map the boolean permissions from absPermissions
    Object.keys(absPermissions).forEach((absKey) => {
      const userPermKey = User.permissionMapping[absKey]
      if (!userPermKey) {
        throw new Error(`Unexpected permission property: ${absKey}`)
      }

      if (!['librariesAccessible', 'itemTagsSelected'].includes(userPermKey)) {
        if (permissionValues[userPermKey] !== !!absPermissions[absKey]) {
          permissionValues[userPermKey] = !!absPermissions[absKey]
          hasUpdates = true
        }
      }
    })

    // Handle allowedLibraries
    const librariesAccessible = this.permissions.librariesAccessible || []
    if (this.permissions.accessAllLibraries) {
      if (librariesAccessible.length) {
        this.permissions.librariesAccessible = []
        hasUpdates = true
      }
    } else if (absPermissions.allowedLibraries?.length && absPermissions.allowedLibraries.join(',') !== librariesAccessible.join(',')) {
      if (absPermissions.allowedLibraries.some((lid) => typeof lid !== 'string')) {
        throw new Error('Invalid permission property "allowedLibraries", expecting array of strings')
      }
      this.permissions.librariesAccessible = absPermissions.allowedLibraries
      hasUpdates = true
    }

    // Handle allowedTags
    const itemTagsSelected = this.permissions.itemTagsSelected || []
    if (this.permissions.accessAllTags) {
      if (itemTagsSelected.length) {
        this.permissions.itemTagsSelected = []
        hasUpdates = true
      }
    } else if (absPermissions.allowedTags?.length && absPermissions.allowedTags.join(',') !== itemTagsSelected.join(',')) {
      if (absPermissions.allowedTags.some((tag) => typeof tag !== 'string')) {
        throw new Error('Invalid permission property "allowedTags", expecting array of strings')
      }
      this.permissions.itemTagsSelected = absPermissions.allowedTags
      hasUpdates = true
    }

    if (hasUpdates) {
      this.changed('permissions', true)
      await this.save()
    }

    return hasUpdates
  }

  // Same overloads as Model.update
  update<K extends keyof UserAttributes>(key: K, value: UserAttributes[K] | Utils.Col | Utils.Fn | Utils.Literal, options?: InstanceUpdateOptions<UserAttributes>): Promise<this>
  update(keys: UpdateValues<UserAttributes>, options?: InstanceUpdateOptions<UserAttributes>): Promise<this>
  async update(values: keyof UserAttributes | UpdateValues<UserAttributes>, options?: InstanceUpdateOptions<UserAttributes> | UserAttributes[keyof UserAttributes] | Utils.Col | Utils.Fn | Utils.Literal): Promise<this> {
    userCache.maybeInvalidate(this)
    // cast(b): the two arguments are forwarded as they came (a third update(key, value, options) argument is dropped, as in the JS); the overloads above type the callers
    return await super.update(values as UpdateValues<UserAttributes>, options as InstanceUpdateOptions<UserAttributes>)
  }

  async save(options?: SaveOptions<UserAttributes>): Promise<this> {
    userCache.maybeInvalidate(this)
    return await super.save(options)
  }

  async destroy(options?: InstanceDestroyOptions): Promise<void> {
    userCache.delete(this.id)
    await super.destroy(options)
  }
}

namespace User {
  export type ProgressUpdatePayload = ProgressUpdatePayloadObject
}

export = User
