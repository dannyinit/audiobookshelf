import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import Logger = require('../Logger')
import utils = require('../utils')
import parseNameString = require('../utils/parsers/parseNameString')
import htmlSanitizer = require('../utils/htmlSanitizer')
import libraryItemsBookFilters = require('../utils/queries/libraryItemsBookFilters')
import SocketAuthority = require('../SocketAuthority')
import type Author = require('./Author')
import type LibraryItem = require('./LibraryItem')
import type MediaProgress = require('./MediaProgress')
import type Series = require('./Series')
import type { AudioFileObject, AudioTrack, ChapterObject, EBookFileObject, ModelsSequelize } from './types'
import type * as ModelTypes from './types'
const { DataTypes, Model } = Sequelize
const { getTitlePrefixAtEnd, getTitleIgnorePrefix } = utils

/**
 * String metadata attributes that updateFromRequest copies from the payload
 */
type BookStringMetadataKey = 'title' | 'subtitle' | 'publishedYear' | 'publishedDate' | 'publisher' | 'description' | 'isbn' | 'asin' | 'language'

/**
 * Book metadata in a request payload (old book metadata), not validated yet
 */
type BookMetadataPayload = { [key in BookStringMetadataKey]?: unknown } & {
  explicit?: unknown
  abridged?: unknown
  narrators?: unknown
  genres?: unknown
}

/**
 * Old book object in a request payload (library item media PATCH), not validated yet
 */
interface BookRequestPayload {
  metadata?: BookMetadataPayload
  tags?: unknown
}

class Book extends Model<InferAttributes<Book>, InferCreationAttributes<Book>> {
  declare id: CreationOptional<string>
  declare title: string | null
  declare titleIgnorePrefix: string | null
  declare subtitle: string | null
  declare publishedYear: string | null
  declare publishedDate: string | null
  declare publisher: string | null
  declare description: string | null
  declare isbn: string | null
  declare asin: string | null
  declare language: string | null
  declare explicit: boolean
  declare abridged: boolean
  declare coverPath: string | null
  declare duration: number
  declare narrators: string[]
  declare audioFiles: AudioFileObject[]
  declare ebookFile: EBookFileObject | null
  declare chapters: ChapterObject[]
  declare tags: string[]
  declare genres: string[]
  declare updatedAt: CreationOptional<Date>
  declare createdAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize

  // Expanded properties

  /** optional if expanded */
  declare authors: NonAttribute<Author[]>
  /** optional if expanded (each series has its bookSeries join row) */
  declare series: NonAttribute<Series[]>
  // Associations, only set when included

  /** Collections, series, authors and playlists load books with their library item (see BookExpandedWithLibraryItem) */
  declare libraryItem?: NonAttribute<LibraryItem>

  declare mediaProgresses?: NonAttribute<MediaProgress[]>

  /**
   * Initialize model
   */
  static init(sequelize: ModelsSequelize): void
  // Model.init signature, only declared so the class stays assignable to Model (Database calls init(sequelize))
  static init<MS extends ModelStatic<Sequelize.Model>, M extends InstanceType<MS>>(this: MS, attributes: ModelAttributes<M, Attributes<M>> | ModelsSequelize, options?: InitOptions<M>): MS
  static init(sequelize: ModelsSequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        title: DataTypes.STRING,
        titleIgnorePrefix: DataTypes.STRING,
        subtitle: DataTypes.STRING,
        publishedYear: DataTypes.STRING,
        publishedDate: DataTypes.STRING,
        publisher: DataTypes.STRING,
        description: DataTypes.TEXT,
        isbn: DataTypes.STRING,
        asin: DataTypes.STRING,
        language: DataTypes.STRING,
        explicit: DataTypes.BOOLEAN,
        abridged: DataTypes.BOOLEAN,
        coverPath: DataTypes.STRING,
        duration: DataTypes.FLOAT,

        narrators: DataTypes.JSON,
        audioFiles: DataTypes.JSON,
        ebookFile: DataTypes.JSON,
        chapters: DataTypes.JSON,
        tags: DataTypes.JSON,
        genres: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'book',
        indexes: [
          {
            fields: [
              {
                name: 'title',
                collate: 'NOCASE'
              }
            ]
          },
          // {
          //   fields: [{
          //     name: 'titleIgnorePrefix',
          //     collate: 'NOCASE'
          //   }]
          // },
          {
            fields: ['publishedYear']
          },
          {
            fields: ['duration']
          }
        ]
      }
    )

    Book.addHook('afterDestroy', async (instance) => {
      libraryItemsBookFilters.clearCountCache('afterDestroy')
    })

    Book.addHook('afterCreate', async (instance) => {
      libraryItemsBookFilters.clearCountCache('afterCreate')
    })
  }

  /**
   * Comma separated array of author names
   * Requires authors to be loaded
   */
  get authorName(): NonAttribute<string> {
    if (this.authors === undefined) {
      Logger.error(`[Book] authorName: Cannot get authorName because authors are not loaded`)
      return ''
    }
    return this.authors.map((au) => au.name).join(', ')
  }

  /**
   * Comma separated array of author names in Last, First format
   * Requires authors to be loaded
   */
  get authorNameLF(): NonAttribute<string> {
    if (this.authors === undefined) {
      Logger.error(`[Book] authorNameLF: Cannot get authorNameLF because authors are not loaded`)
      return ''
    }

    // Last, First
    if (!this.authors.length) return ''
    return this.authors.map((au) => parseNameString.nameToLastFirst(au.name)).join(', ')
  }

  /**
   * Comma separated array of series with sequence
   * Requires series to be loaded
   */
  get seriesName(): NonAttribute<string> {
    if (this.series === undefined) {
      Logger.error(`[Book] seriesName: Cannot get seriesName because series are not loaded`)
      return ''
    }

    if (!this.series.length) return ''
    return this.series
      .map((se) => {
        const sequence = se.bookSeries?.sequence || ''
        if (!sequence) return se.name
        return `${se.name} #${sequence}`
      })
      .join(', ')
  }

  get includedAudioFiles(): NonAttribute<AudioFileObject[]> {
    return this.audioFiles.filter((af) => !af.exclude)
  }

  get hasMediaFiles(): NonAttribute<boolean> {
    return !!this.hasAudioTracks || !!this.ebookFile
  }

  get hasAudioTracks(): NonAttribute<boolean> {
    return !!this.includedAudioFiles.length
  }

  /**
   * Supported mime types are sent from the web client and are retrieved using the browser Audio player "canPlayType" function.
   */
  checkCanDirectPlay(supportedMimeTypes: string[]): boolean {
    if (!Array.isArray(supportedMimeTypes)) {
      Logger.error(`[Book] checkCanDirectPlay: supportedMimeTypes is not an array`, supportedMimeTypes)
      return false
    }
    return this.includedAudioFiles.every((af) => supportedMimeTypes.includes(af.mimeType))
  }

  /**
   * Get the track list to be used in client audio players
   * AudioTrack is the AudioFile with startOffset, contentUrl and title
   */
  getTracklist(libraryItemId: string): AudioTrack[] {
    let startOffset = 0
    return this.includedAudioFiles.map((af) => {
      // cast(d): the clone gets the track properties (title, startOffset, contentUrl) assigned below
      const track = structuredClone(af) as AudioTrack
      track.title = af.metadata.filename
      track.startOffset = startOffset
      track.contentUrl = `/api/items/${libraryItemId}/file/${track.ino}`
      startOffset += track.duration
      return track
    })
  }

  getChapters(): ChapterObject[] {
    return structuredClone(this.chapters) || []
  }

  getPlaybackTitle() {
    return this.title
  }

  getPlaybackAuthor() {
    return this.authorName
  }

  getPlaybackDuration() {
    return this.duration
  }

  /**
   * Total file size of all audio files and ebook file
   */
  get size(): NonAttribute<number> {
    let total = 0
    this.audioFiles.forEach((af) => (total += af.metadata.size))
    if (this.ebookFile) {
      total += this.ebookFile.metadata.size
    }
    return total
  }

  getAbsMetadataJson() {
    return {
      tags: this.tags || [],
      chapters: this.chapters?.map((c) => ({ ...c })) || [],
      title: this.title,
      subtitle: this.subtitle,
      authors: this.authors.map((a) => a.name),
      narrators: this.narrators,
      series: this.series.map((se) => {
        const sequence = se.bookSeries?.sequence || ''
        if (!sequence) return se.name
        return `${se.name} #${sequence}`
      }),
      genres: this.genres || [],
      publishedYear: this.publishedYear,
      publishedDate: this.publishedDate,
      publisher: this.publisher,
      description: this.description,
      isbn: this.isbn,
      asin: this.asin,
      language: this.language,
      explicit: !!this.explicit,
      abridged: !!this.abridged
    }
  }

  /**
   * @param payload - old book object
   */
  async updateFromRequest(payload: BookRequestPayload): Promise<boolean> {
    if (!payload) return false

    let hasUpdates = false

    if (payload.metadata) {
      // Same object as payload.metadata, so the check above also holds in the callbacks below
      const metadata = payload.metadata
      const metadataStringKeys: BookStringMetadataKey[] = ['title', 'subtitle', 'publishedYear', 'publishedDate', 'publisher', 'description', 'isbn', 'asin', 'language']
      metadataStringKeys.forEach((key) => {
        if (typeof metadata[key] == 'number') {
          metadata[key] = String(metadata[key])
        }

        if ((typeof metadata[key] === 'string' || metadata[key] === null) && this[key] !== metadata[key]) {
          // Sanitize description HTML
          if (key === 'description' && metadata[key]) {
            const sanitizedDescription = htmlSanitizer.sanitize(metadata[key])
            if (sanitizedDescription !== metadata[key]) {
              Logger.debug(`[Book] "${this.title}" Sanitized description from "${metadata[key]}" to "${sanitizedDescription}"`)
              metadata[key] = sanitizedDescription
            }
          }

          // cast(d): checked above to be a string or null (a sanitized description is a string)
          this[key] = (metadata[key] as string | null) || null

          if (key === 'title') {
            this.titleIgnorePrefix = getTitleIgnorePrefix(this.title)
          }

          hasUpdates = true
        }
      })
      if (payload.metadata.explicit !== undefined && this.explicit !== !!payload.metadata.explicit) {
        this.explicit = !!payload.metadata.explicit
        hasUpdates = true
      }
      if (payload.metadata.abridged !== undefined && this.abridged !== !!payload.metadata.abridged) {
        this.abridged = !!payload.metadata.abridged
        hasUpdates = true
      }
      const arrayOfStringsKeys: ('narrators' | 'genres')[] = ['narrators', 'genres']
      arrayOfStringsKeys.forEach((key) => {
        if (Array.isArray(metadata[key]) && !metadata[key].some((item) => typeof item !== 'string') && JSON.stringify(this[key]) !== JSON.stringify(metadata[key])) {
          this[key] = metadata[key]
          this.changed(key, true)
          hasUpdates = true
        }
      })
    }

    if (Array.isArray(payload.tags) && !payload.tags.some((tag) => typeof tag !== 'string') && JSON.stringify(this.tags) !== JSON.stringify(payload.tags)) {
      this.tags = payload.tags
      this.changed('tags', true)
      hasUpdates = true
    }

    if (hasUpdates) {
      Logger.debug(`[Book] "${this.title}" changed keys:`, this.changed())
      await this.save()
    }

    return hasUpdates
  }

  /**
   * Creates or removes authors from the book using the author names from the request
   *
   * @returns null if authors is not an array
   */
  async updateAuthorsFromRequest(authors: string[], libraryId: string): Promise<{ authorsRemoved: Author[]; authorsAdded: Author[] } | null> {
    if (!Array.isArray(authors)) return null

    if (!this.authors) {
      throw new Error(`[Book] Cannot update authors because authors are not loaded for book ${this.id}`)
    }

    const authorModel = this.sequelize.models.author

    const bookAuthorModel = this.sequelize.models.bookAuthor

    const authorsCleaned = authors.map((a) => a.toLowerCase()).filter((a) => a)
    const authorsRemoved = this.authors.filter((au) => !authorsCleaned.includes(au.name.toLowerCase()))
    const newAuthorNames = authors.filter((a) => !this.authors.some((au) => au.name.toLowerCase() === a.toLowerCase()))

    for (const author of authorsRemoved) {
      await bookAuthorModel.removeByIds(author.id, this.id)
      const numBooks = await bookAuthorModel.getCountForAuthor(author.id)
      if (numBooks > 0) {
        SocketAuthority.emitter('author_updated', author.toOldJSONExpanded(numBooks))
      }
      Logger.debug(`[Book] "${this.title}" Removed author "${author.name}"`)
      this.authors = this.authors.filter((au) => au.id !== author.id)
    }
    const authorsAdded: Author[] = []
    for (const authorName of newAuthorNames) {
      const { author, created } = await authorModel.findOrCreateByNameAndLibrary(authorName, libraryId)
      await bookAuthorModel.create({ bookId: this.id, authorId: author.id })
      if (created) {
        SocketAuthority.emitter('author_added', author.toOldJSON())
      } else {
        const numBooks = await bookAuthorModel.getCountForAuthor(author.id)
        SocketAuthority.emitter('author_updated', author.toOldJSONExpanded(numBooks))
      }
      Logger.debug(`[Book] "${this.title}" Added author "${author.name}"`)
      this.authors.push(author)
      authorsAdded.push(author)
    }

    return {
      authorsRemoved,
      authorsAdded
    }
  }

  /**
   * Creates or removes series from the book using the series names from the request.
   * Updates series sequence if it has changed.
   *
   * @returns null if seriesObjects is not an array of series with names
   */
  async updateSeriesFromRequest(seriesObjects: { name: string; sequence: string }[], libraryId: string): Promise<{ seriesRemoved: Series[]; seriesAdded: Series[]; hasUpdates: boolean } | null> {
    if (!Array.isArray(seriesObjects) || seriesObjects.some((se) => !se.name || typeof se.name !== 'string')) return null

    if (!this.series) {
      throw new Error(`[Book] Cannot update series because series are not loaded for book ${this.id}`)
    }

    const seriesModel = this.sequelize.models.series

    const bookSeriesModel = this.sequelize.models.bookSeries

    const seriesNamesCleaned = seriesObjects.map((se) => se.name.toLowerCase())
    const seriesRemoved = this.series.filter((se) => !seriesNamesCleaned.includes(se.name.toLowerCase()))
    const seriesAdded: Series[] = []
    let hasUpdates = false
    for (const seriesObj of seriesObjects) {
      const seriesObjSequence = typeof seriesObj.sequence === 'string' ? seriesObj.sequence : null

      const existingSeries = this.series.find((se) => se.name.toLowerCase() === seriesObj.name.toLowerCase())
      if (existingSeries) {
        if (existingSeries.bookSeries.sequence !== seriesObjSequence) {
          existingSeries.bookSeries.sequence = seriesObjSequence
          await existingSeries.bookSeries.save()
          hasUpdates = true
          Logger.debug(`[Book] "${this.title}" Updated series "${existingSeries.name}" sequence ${seriesObjSequence}`)
        }
      } else {
        const series = await seriesModel.findOrCreateByNameAndLibrary(seriesObj.name, libraryId)
        series.bookSeries = await bookSeriesModel.create({ bookId: this.id, seriesId: series.id, sequence: seriesObjSequence })
        this.series.push(series)
        seriesAdded.push(series)
        hasUpdates = true
        Logger.debug(`[Book] "${this.title}" Added series "${series.name}"`)
      }
    }

    for (const series of seriesRemoved) {
      await bookSeriesModel.removeByIds(series.id, this.id)
      this.series = this.series.filter((se) => se.id !== series.id)
      Logger.debug(`[Book] "${this.title}" Removed series ${series.id}`)
      hasUpdates = true
    }

    return {
      seriesRemoved,
      seriesAdded,
      hasUpdates
    }
  }

  /**
   * Old model kept metadata in a separate object
   */
  oldMetadataToJSON() {
    const authors = this.authors.map((au) => ({ id: au.id, name: au.name }))
    const series = this.series.map((se) => ({ id: se.id, name: se.name, sequence: se.bookSeries.sequence }))
    return {
      title: this.title,
      subtitle: this.subtitle,
      authors,
      narrators: [...(this.narrators || [])],
      series,
      genres: [...(this.genres || [])],
      publishedYear: this.publishedYear,
      publishedDate: this.publishedDate,
      publisher: this.publisher,
      description: this.description,
      isbn: this.isbn,
      asin: this.asin,
      language: this.language,
      explicit: this.explicit,
      abridged: this.abridged
    }
  }

  oldMetadataToJSONMinified() {
    return {
      title: this.title,
      titleIgnorePrefix: getTitlePrefixAtEnd(this.title),
      subtitle: this.subtitle,
      authorName: this.authorName,
      authorNameLF: this.authorNameLF,
      narratorName: (this.narrators || []).join(', '),
      seriesName: this.seriesName,
      genres: [...(this.genres || [])],
      publishedYear: this.publishedYear,
      publishedDate: this.publishedDate,
      publisher: this.publisher,
      description: this.description,
      isbn: this.isbn,
      asin: this.asin,
      language: this.language,
      explicit: this.explicit,
      abridged: this.abridged
    }
  }

  oldMetadataToJSONExpanded() {
    // Typed with the expanded properties, which are added below
    const oldMetadataJSON: ReturnType<Book['oldMetadataToJSON']> & {
      titleIgnorePrefix?: string | null
      authorName?: string
      authorNameLF?: string
      narratorName?: string
      seriesName?: string
      descriptionPlain?: string | null
    } = this.oldMetadataToJSON()
    oldMetadataJSON.titleIgnorePrefix = getTitlePrefixAtEnd(this.title)
    oldMetadataJSON.authorName = this.authorName
    oldMetadataJSON.authorNameLF = this.authorNameLF
    oldMetadataJSON.narratorName = (this.narrators || []).join(', ')
    oldMetadataJSON.seriesName = this.seriesName
    oldMetadataJSON.descriptionPlain = this.description ? htmlSanitizer.stripAllTags(this.description) : null
    return oldMetadataJSON
  }

  /**
   * The old model stored a minified series and authors array with the book object.
   * Minified series is { id, name, sequence }
   * Minified author is { id, name }
   */
  toOldJSON(libraryItemId: string) {
    if (!libraryItemId) {
      throw new Error(`[Book] Cannot convert to old JSON because libraryItemId is not provided`)
    }
    if (!this.authors) {
      throw new Error(`[Book] Cannot convert to old JSON because authors are not loaded`)
    }
    if (!this.series) {
      throw new Error(`[Book] Cannot convert to old JSON because series are not loaded`)
    }

    return {
      id: this.id,
      libraryItemId: libraryItemId,
      metadata: this.oldMetadataToJSON(),
      coverPath: this.coverPath,
      tags: [...(this.tags || [])],
      audioFiles: structuredClone(this.audioFiles),
      chapters: structuredClone(this.chapters),
      ebookFile: structuredClone(this.ebookFile)
    }
  }

  /**
   * Minified book JSON for list/shelf endpoints.
   * `toOldJSONExpanded()` must be a strict superset: every key here must exist in expanded
   * with the same value semantics. Only additive changes to expanded; never remove or rename keys.
   */
  toOldJSONMinified() {
    if (!this.authors) {
      throw new Error(`[Book] Cannot convert to old JSON because authors are not loaded`)
    }
    if (!this.series) {
      throw new Error(`[Book] Cannot convert to old JSON because series are not loaded`)
    }

    return {
      id: this.id,
      metadata: this.oldMetadataToJSONMinified(),
      coverPath: this.coverPath,
      tags: [...(this.tags || [])],
      numTracks: this.includedAudioFiles.length,
      numAudioFiles: this.audioFiles?.length || 0,
      numChapters: this.chapters?.length || 0,
      duration: this.duration,
      size: this.size,
      ebookFormat: this.ebookFile?.ebookFormat
    }
  }

  /**
   * Expanded book JSON for item detail and socket events.
   * Must be a strict superset of `toOldJSONMinified()` — built by spreading minified, then adding expanded-only fields.
   */
  toOldJSONExpanded(libraryItemId: string) {
    if (!libraryItemId) {
      throw new Error(`[Book] Cannot convert to old JSON because libraryItemId is not provided`)
    }
    if (!this.authors) {
      throw new Error(`[Book] Cannot convert to old JSON because authors are not loaded`)
    }
    if (!this.series) {
      throw new Error(`[Book] Cannot convert to old JSON because series are not loaded`)
    }

    return {
      ...this.toOldJSONMinified(),
      libraryItemId,
      metadata: this.oldMetadataToJSONExpanded(),
      audioFiles: structuredClone(this.audioFiles),
      chapters: structuredClone(this.chapters),
      ebookFile: structuredClone(this.ebookFile),
      tracks: this.getTracklist(libraryItemId)
    }
  }
}

namespace Book {
  export type EBookFileObject = ModelTypes.EBookFileObject
  export type ChapterObject = ModelTypes.ChapterObject
  export type AudioFileObject = ModelTypes.AudioFileObject
  export type AudioTrack = ModelTypes.AudioTrack
  /** Series loaded through a book, with its bookSeries join row */
  export type SeriesExpanded = Series
  /** Book with authors and series loaded */
  export type BookExpanded = Book
  /** Book with authors, series and libraryItem loaded (collections and series) */
  export type BookExpandedWithLibraryItem = Book & { libraryItem: LibraryItem }
}

export = Book
