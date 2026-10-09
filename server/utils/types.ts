/**
 * Types shared by the files in server/utils.
 */
/// <reference path="./ssrf-req-filter.d.ts" />
import type * as fsPromises from 'fs/promises'
import type * as fsSync from 'fs'
type ServerSettingsModel = import('../objects/settings/ServerSettings')
import type { ModelRegistry, ModelsSequelize } from '../models/types'

/**
 * Methods the vendored fs-extra (server/libs/fsExtra) adds on top of node fs (only the ones used)
 */
interface FsExtraMethods {
  copy(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void>
  move(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void>
  remove(path: string): Promise<void>
  pathExists(path: string): Promise<boolean>
  pathExistsSync(path: string): boolean
  ensureDir(path: string, options?: { mode?: number }): Promise<void>
  emptyDir(path: string): Promise<void>
}

/**
 * Shape of server/libs/fsExtra.
 * The vendored fs-extra builds its fs API at runtime (promisified graceful-fs), so the type TypeScript infers
 * from the JS lacks most fs methods. Files cast the required module to this type.
 */
export type FsExtra = typeof fsPromises & Omit<typeof fsSync, keyof typeof fsPromises> & FsExtraMethods

/**
 * Values the server stores on `global` (set in Server.js, Database.js and index.js)
 */
type ServerSettingsJson = ReturnType<ServerSettingsModel['toJSON']>

declare global {
  var ServerSettings: ServerSettingsJson
  var isWin: boolean
  var ConfigPath: string
  var MetadataPath: string
  var DisableSsrfRequestFilter: ((url: string) => boolean) | undefined
  var PodcastDownloadTimeout: number
  var MaxFailedEpisodeChecks: number
  var XAccel: string | undefined
  /** Directory of index.js / prod.js (set there) */
  var appRoot: string

  namespace NodeJS {
    interface Process {
      /** Set when the server runs as a pkg executable */
      pkg?: unknown
    }
  }
}

/**
 * File found when recursing a library folder (see fileUtils.recurseFiles)
 */
export interface FilePathItem {
  /** file name e.g. "audiofile.m4b" */
  name: string
  /** fullpath excluding folder e.g. "Author/Book/audiofile.m4b" */
  path: string
  /** path excluding file name e.g. "Author/Book" */
  reldirpath: string
  /** full path e.g. "/audiobooks/Author/Book/audiofile.m4b" */
  fullpath: string
  /** file extension e.g. ".m4b" */
  extension: string
  /** depth of file in directory (0 is file in folder root) */
  deep: number
}

/**
 * Archive returned by the vendored archiver (server/libs/archiver), only the methods used
 */
export interface ZipArchive {
  pointer(): number
  on(event: 'warning' | 'error', listener: (err: NodeJS.ErrnoException) => void): this
  on(event: 'progress', listener: (progress: { fs: { processedBytes: number } }) => void): this
  abort(): this
  append(source: string, data: { name: string }): this
  pipe<T extends NodeJS.WritableStream>(destination: T): T
  directory(dirpath: string, destpath: string | false): this
  file(filepath: string, data: { name: string }): this
  finalize(): Promise<void>
}

/**
 * The vendored archiver is a function with expando properties, which TypeScript infers as a non-callable class.
 * Files cast the required module to this type.
 */
export type ArchiverFactory = (format: 'zip', options: { zlib?: { level: number } }) => ZipArchive

type DatabaseInstance = typeof import('../Database')

/**
 * server/Database after Database.init has run. Database.js (still JS) sets sequelize to null in the constructor
 * and to the Sequelize instance in init, so it is typed `Sequelize | null`; code that only runs after init
 * (routes, library queries, migrations called from init) uses this type. `models` is the getter for sequelize.models.
 */
export type InitializedDatabase = DatabaseInstance & { sequelize: ModelsSequelize; models: ModelRegistry }

/**
 * Filter menu data for a library, cached on Database.libraryFilterData
 */
export interface LibraryFilterData {
  authors: { id: string; name: string }[]
  genres: string[]
  tags: string[]
  series: { id: string; name: string }[]
  narrators: string[]
  languages: string[]
  publishers: string[]
  publishedDecades: string[]
  bookCount: number
  authorCount: number
  seriesCount: number
  podcastCount: number
  numIssues: number
  loadedAt: number
}

/**
 * PlaybackSession mediaMetadata JSON column (only the fields read by the stats queries)
 */
export interface PlaybackMediaMetadata {
  authors?: { id?: string; name: string }[]
  narrators?: string[]
  genres?: string[]
}

type SortByFn<T> = (item: T) => unknown

/**
 * Sort direction object passed to by(), e.g. { asc: (item) => item.title }
 */
export interface SortByObject<T> {
  asc?: SortByFn<T>
  desc?: SortByFn<T>
}

/**
 * Sort instance returned by createNewSortInstance in the vendored fast-sort (server/libs/fastSort),
 * whose inferred JS type has untyped parameters. Files cast the created instance to this type
 */
export type SortInstance = <T>(ctx: T[]) => {
  asc(sortBy?: SortByFn<T> | SortByFn<T>[]): T[]
  desc(sortBy?: SortByFn<T> | SortByFn<T>[]): T[]
  by(sortBy: SortByObject<T> | SortByObject<T>[]): T[]
}

/**
 * Text search query created by Database.createTextSearchQuery (see Database TextSearchQuery)
 */
export type TextSearchQuery = InstanceType<DatabaseInstance['TextSearchQuery']>

/**
 * ffprobe data parsed by utils/prober (parseProbeData), read by scanner/MediaProbeData
 */
export type ProbeTags = Record<string, string>

export interface ProbeStreamInfo {
  index: number
  type: string | undefined
  codec: string | null
  codec_long: string | null
  codec_time_base: string | null
  time_base: string | null
  bit_rate: number | null
  language: string | null
  title: string | null
  tags?: ProbeTags
  is_default?: boolean
  profile?: string | null
  is_avc?: boolean
  pix_fmt?: string | null
  frame_rate?: number | null
  width?: number | null
  height?: number | null
  color_range?: string | null
  color_space?: string | null
  color_transfer?: string | null
  color_primaries?: string | null
  channels?: number | null
  sample_rate?: number | null
  channel_layout?: string | null | undefined
}

export interface ProbeChapter {
  id?: number
  start: number
  end: number
  title: string
}

export interface RawProbeData {
  format: string
  duration: number | null
  size: number | null
  sizeMb: number | null
  bit_rate: number | null
  tags: Record<string, string | null>
  rawTags?: ProbeTags
  video_stream?: ProbeStreamInfo
  audio_stream?: ProbeStreamInfo | null
  chapters?: ProbeChapter[]
}
