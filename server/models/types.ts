/**
 * Types shared by the models in server/models (JSON column shapes and the model registry).
 */
import type { Sequelize, Utils } from 'sequelize'
import type { AudioChapter, FileMetadataJSON } from '../objects/types'
import type AudioMetaTags = require('../objects/metadata/AudioMetaTags')
import type ApiKey = require('./ApiKey')
import type Author = require('./Author')
import type Book = require('./Book')
import type BookAuthor = require('./BookAuthor')
import type BookSeries = require('./BookSeries')
import type Collection = require('./Collection')
import type CollectionBook = require('./CollectionBook')
import type CustomMetadataProvider = require('./CustomMetadataProvider')
import type Device = require('./Device')
import type Feed = require('./Feed')
import type FeedEpisode = require('./FeedEpisode')
import type Library = require('./Library')
import type LibraryFolder = require('./LibraryFolder')
import type LibraryItem = require('./LibraryItem')
import type MediaItemShare = require('./MediaItemShare')
import type MediaProgress = require('./MediaProgress')
import type PlaybackSession = require('./PlaybackSession')
import type Playlist = require('./Playlist')
import type PlaylistMediaItem = require('./PlaylistMediaItem')
import type Podcast = require('./Podcast')
import type PodcastEpisode = require('./PodcastEpisode')
import type Series = require('./Series')
import type Session = require('./Session')
import type Setting = require('./Setting')
import type User = require('./User')

/**
 * The models registered on the sequelize instance by Database.buildModels (sequelize.models.<modelName>)
 */
export interface ModelRegistry {
  user: typeof User
  session: typeof Session
  apiKey: typeof ApiKey
  library: typeof Library
  libraryFolder: typeof LibraryFolder
  book: typeof Book
  podcast: typeof Podcast
  podcastEpisode: typeof PodcastEpisode
  libraryItem: typeof LibraryItem
  mediaProgress: typeof MediaProgress
  series: typeof Series
  bookSeries: typeof BookSeries
  author: typeof Author
  bookAuthor: typeof BookAuthor
  collection: typeof Collection
  collectionBook: typeof CollectionBook
  playlist: typeof Playlist
  playlistMediaItem: typeof PlaylistMediaItem
  device: typeof Device
  playbackSession: typeof PlaybackSession
  feed: typeof Feed
  feedEpisode: typeof FeedEpisode
  setting: typeof Setting
  customMetadataProvider: typeof CustomMetadataProvider
  mediaItemShare: typeof MediaItemShare
}

/**
 * The sequelize instance the models are initialised with, with its models typed.
 * Models declare their `sequelize` (instance and static) with this type; Model types the static one as optional,
 * but it is set by init, which Database.buildModels calls before any query.
 */
export type ModelsSequelize = Sequelize & {
  models: ModelRegistry
  /** Added to the sequelize instance by Database.init */
  uppercaseFirst(str: string): string
}

/**
 * Values Model#update accepts for the attributes A (the keys form of Model.update), used by the models that override update
 */
export type UpdateValues<A> = { [key in keyof A]?: A[key] | Utils.Fn | Utils.Col | Utils.Literal }

/**
 * Chapter stored in the chapters JSON column of books and podcast episodes
 */
export type ChapterObject = AudioChapter

/**
 * File metadata stored with audio, ebook and library files in the JSON columns
 */
export type FileMetadataObject = FileMetadataJSON

/**
 * Book ebookFile JSON column
 */
export interface EBookFileObject {
  ino: string
  ebookFormat: string
  addedAt: number
  updatedAt: number
  metadata: FileMetadataObject
}

/**
 * Audio file stored in the Book audioFiles and PodcastEpisode audioFile JSON columns (see objects/files/AudioFile toJSON)
 */
export interface AudioFileObject {
  index: number
  ino: string
  metadata: FileMetadataObject
  addedAt: number
  updatedAt: number
  trackNumFromMeta: number
  discNumFromMeta: number
  trackNumFromFilename: number
  discNumFromFilename: number
  manuallyVerified: boolean
  /** Excluded audio files are not part of the track list (see Book includedAudioFiles) */
  exclude?: boolean
  format: string
  duration: number
  bitRate: number
  language: string
  codec: string
  timeBase: string
  channels: number
  channelLayout: string
  chapters: ChapterObject[]
  /** Codec of the embedded cover art stream (see objects/files/AudioFile toJSON) */
  embeddedCoverArt?: string | null
  /** AudioMetaTags toJSON */
  metaTags: ReturnType<AudioMetaTags['toJSON']>
  mimeType: string
}

/**
 * Audio file with the properties added for client audio players (see Book getTracklist, PodcastEpisode getAudioTrack)
 */
export interface AudioTrack extends AudioFileObject {
  title: string
  contentUrl: string
  startOffset: number
}

/**
 * LibraryItem libraryFiles JSON column
 */
export interface LibraryFileObject {
  ino: string
  isSupplementary: boolean
  addedAt: number
  updatedAt: number
  /** Set by objects/files/LibraryFile (toJSON) */
  fileType: string
  metadata: FileMetadataObject
}

/**
 * Library settings JSON column.
 * Podcast libraries only store some of the keys (see Library.getDefaultLibrarySettingsForMediaType).
 */
export interface LibrarySettingsObject {
  /** BookCoverAspectRatio */
  coverAspectRatio: number
  disableWatcher: boolean
  skipMatchingMediaWithAsin?: boolean
  skipMatchingMediaWithIsbn?: boolean
  autoScanCronExpression: string | null
  audiobooksOnly?: boolean
  epubsAllowScriptedContent?: boolean
  /** Do not show series that only have 1 book */
  hideSingleBookSeries?: boolean
  /** Skip showing books that are earlier than the max sequence read */
  onlyShowLaterBooksInContinueSeries?: boolean
  metadataPrecedence?: string[]
  podcastSearchRegion?: string
  /** Time remaining in seconds to mark as finished. (defaults to 10s) */
  markAsFinishedTimeRemaining: number | null
  /** Percent complete to mark as finished (0-100). If this is set it will be used over markAsFinishedTimeRemaining. */
  markAsFinishedPercentComplete: number | null
}

/**
 * Library extraData JSON column
 */
export interface LibraryExtraData {
  lastScanMetadataPrecedence?: string[]
  /** Library id before the 2.3.0 database migration */
  oldLibraryId?: string
}

/**
 * LibraryItem extraData JSON column
 */
export interface LibraryItemExtraData {
  /** Library item id before the 2.3.0 database migration */
  oldLibraryItemId?: string
}

/**
 * PodcastEpisode extraData JSON column
 */
export interface PodcastEpisodeExtraData {
  guid?: string
  /** Episode id before the 2.3.0 database migration */
  oldEpisodeId?: string
}

/**
 * MediaProgress extraData JSON column
 */
export interface MediaProgressExtraData {
  libraryItemId?: string
  /** Value between 0 and 1 (the old model stored progress on the object) */
  progress?: number
}

/**
 * PlaybackSession extraData JSON column
 */
export interface PlaybackSessionExtraData {
  libraryItemId?: string | null
}

/**
 * Device extraData JSON column (see Device.getFromOld)
 */
export interface DeviceExtraData {
  manufacturer?: string
  model?: string
  osName?: string
  osVersion?: string
  browserName?: string
}

/**
 * User and ApiKey permissions JSON column.
 * The keys are optional because users stored by older versions may lack some of them.
 * A type alias (not an interface) so it can be read and written by key through a Record alias.
 */
export type UserPermissions = {
  download?: boolean
  update?: boolean
  delete?: boolean
  upload?: boolean
  createEreader?: boolean
  accessAllLibraries?: boolean
  accessAllTags?: boolean
  accessExplicitContent?: boolean
  /** Inverts itemTagsSelected */
  selectedTagsNotAccessible?: boolean
  librariesAccessible?: string[]
  itemTagsSelected?: string[]
}

/**
 * User extraData JSON column
 */
export interface UserExtraData {
  seriesHideFromContinueListening?: string[]
  authOpenIDSub?: string
  /** User id before the 2.3.0 database migration */
  oldUserId?: string
}

/**
 * User bookmarks JSON column
 */
export interface AudioBookmarkObject {
  libraryItemId: string
  title: string
  time: number
  createdAt: number
}

/**
 * Episode parsed from an RSS feed (the RssPodcastEpisode type in utils/podcastUtils)
 */
export type RssPodcastEpisode = NonNullable<ReturnType<typeof import('../utils/podcastUtils').findMatchingEpisodesInFeed>>[number]['episode']
