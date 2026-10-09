import Sequelize = require('sequelize')
import DatabaseModule = require('../../Database')
import Logger = require('../../Logger')
import authorFilters = require('./authorFilters')

import ShareManager = require('../../managers/ShareManager')
import profiler = require('../profiler')
import stringifySequelizeQuery = require('../stringifySequelizeQuery')
import User = require('../../models/User')
import Library = require('../../models/Library')
import Book = require('../../models/Book')
import BookSeries = require('../../models/BookSeries')
import BookAuthor = require('../../models/BookAuthor')
import Author = require('../../models/Author')
import Series = require('../../models/Series')
import LibraryItem = require('../../models/LibraryItem')
import type { CountOptions, FindAndCountOptions, FindOptions } from 'sequelize'
import type { InitializedDatabase } from '../types'
import type { FilteredLibraryItem, QueryInclude, QueryOrderItem, QueryReplacements, RuntimeFindOptions, UserPermissionBookWhere, UserPermissions, WhereItem } from './types'
const { profile } = profiler

// cast(d): Database.js is still JS; sequelize is null until Database.init, which runs before any query
const Database = DatabaseModule as InitializedDatabase

const countCache = new Map<string, number>()

/**
 * Book model as loaded by these queries. The included associations are optional because the mapping code
 * moves them around (bookSeries -> series, bookAuthors -> authors, libraryItem -> libraryItem.media)
 */
type BookRow = Omit<Book, 'series' | 'authors' | 'bookSeries' | 'bookAuthors'> & {
  libraryItem?: FilteredLibraryItem
  bookSeries?: BookSeriesRow[]
  bookAuthors?: BookAuthorRow[]
  series?: SeriesRow[]
  authors?: Author[]
}

/**
 * BookSeries join row with the included series and/or book
 */
type BookSeriesRow = BookSeries & {
  series?: SeriesRow
  book: BookRow
}

/**
 * Series with its book_series join row (as included through a book, or attached by the mapping code)
 */
type SeriesRow = Series & {
  bookSeries: { id: string; sequence: string | null }
}

type BookAuthorRow = BookAuthor & { author: Author }

/**
 * Series with its book_series join rows (each with the included book)
 */
type SeriesWithBookSeries = Series & {
  bookSeries: BookSeriesRow[]
  /** With the maxSequence attribute the query selects */
  dataValues: Series['dataValues'] & { maxSequence: number }
}

type BookExpanded = import('../../models/Book').BookExpanded

/**
 * Series row as loaded by getCollapseSeriesBooksToExclude
 */
type CollapseSeriesRow = Series & {
  books: (Book & { bookSeries: BookSeries; libraryItem: LibraryItem })[]
  /** With the numBooks attribute the query selects */
  dataValues: Series['dataValues'] & { numBooks: number }
}

interface CollapseSeriesBookSeries {
  id: string
  numBooks: number
  libraryItemIds: string[]
}

/**
 * Row of the value/count json_each queries
 */
interface ValueCountRow {
  value: string
  numItems: number
  numBooks: number
}

export = {
  /**
   * User permissions to restrict books for explicit content & tags
   */
  getUserPermissionBookWhereQuery(user: User | null | undefined): UserPermissionBookWhere {
    const bookWhere: WhereItem[] = []
    const replacements: QueryReplacements = {}
    if (!user) return { bookWhere, replacements }

    if (!user.canAccessExplicitContent) {
      bookWhere.push({
        explicit: false
      })
    }
    // permissions is a JSON column
    const permissions = user.permissions as UserPermissions | null
    if (!permissions?.accessAllTags && permissions?.itemTagsSelected?.length) {
      replacements['userTagsSelected'] = permissions.itemTagsSelected
      if (permissions.selectedTagsNotAccessible) {
        bookWhere.push(Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(tags) WHERE json_valid(tags) AND json_each.value IN (:userTagsSelected))`), 0))
      } else {
        bookWhere.push(
          Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(tags) WHERE json_valid(tags) AND json_each.value IN (:userTagsSelected))`), {
            [Sequelize.Op.gte]: 1
          })
        )
      }
    }
    return {
      bookWhere,
      replacements
    }
  },

  /**
   * When collapsing series and filtering by progress
   * different where options are required
   */
  getCollapseSeriesMediaProgressFilter(value: string | null | undefined): Record<string | symbol, unknown> {
    const mediaWhere: Record<string | symbol, unknown> = {}
    if (value === 'not-finished') {
      mediaWhere['$books.mediaProgresses.isFinished$'] = {
        [Sequelize.Op.or]: [null, false]
      }
    } else if (value === 'not-started') {
      mediaWhere[Sequelize.Op.and] = [
        {
          '$books.mediaProgresses.currentTime$': {
            [Sequelize.Op.or]: [null, 0]
          }
        },
        {
          '$books.mediaProgresses.isFinished$': {
            [Sequelize.Op.or]: [null, false]
          }
        }
      ]
    } else if (value === 'finished') {
      mediaWhere['$books.mediaProgresses.isFinished$'] = true
    } else if (value === 'in-progress') {
      mediaWhere[Sequelize.Op.and] = [
        {
          [Sequelize.Op.or]: [
            {
              '$books.mediaProgresses.currentTime$': {
                [Sequelize.Op.gt]: 0
              }
            },
            {
              '$books.mediaProgresses.ebookProgress$': {
                [Sequelize.Op.gt]: 0
              }
            }
          ]
        },
        {
          '$books.mediaProgresses.isFinished$': false
        }
      ]
    }
    return mediaWhere
  },

  /**
   * Get where options for Book model
   */
  getMediaGroupQuery(group: string | null | undefined, value: string | null | undefined): { mediaWhere: Record<string | symbol, unknown> | WhereItem | WhereItem[]; replacements: QueryReplacements } {
    if (!group) return { mediaWhere: {}, replacements: {} }

    // Properties are only set while mediaWhere is still this object; branches that replace mediaWhere set none
    const mediaWhereHash: Record<string | symbol, unknown> = {}
    let mediaWhere: Record<string | symbol, unknown> | WhereItem | WhereItem[] = mediaWhereHash
    const replacements: QueryReplacements = {}

    if (group === 'progress') {
      if (value === 'not-finished') {
        mediaWhereHash['$mediaProgresses.isFinished$'] = {
          [Sequelize.Op.or]: [null, false]
        }
      } else if (value === 'not-started') {
        mediaWhereHash[Sequelize.Op.and] = [
          {
            '$mediaProgresses.currentTime$': {
              [Sequelize.Op.or]: [null, 0]
            }
          },
          {
            '$mediaProgresses.isFinished$': {
              [Sequelize.Op.or]: [null, false]
            }
          }
        ]
      } else if (value === 'finished') {
        mediaWhereHash['$mediaProgresses.isFinished$'] = true
      } else if (value === 'in-progress') {
        mediaWhereHash[Sequelize.Op.and] = [
          {
            [Sequelize.Op.or]: [
              {
                '$mediaProgresses.currentTime$': {
                  [Sequelize.Op.gt]: 0
                }
              },
              {
                '$mediaProgresses.ebookProgress$': {
                  [Sequelize.Op.gt]: 0
                }
              }
            ]
          },
          {
            '$mediaProgresses.isFinished$': false
          }
        ]
      } else if (value === 'audio-in-progress') {
        mediaWhereHash[Sequelize.Op.and] = [
          {
            '$mediaProgresses.currentTime$': {
              [Sequelize.Op.gt]: 0
            }
          },
          {
            '$mediaProgresses.isFinished$': false
          }
        ]
      } else if (value === 'ebook-in-progress') {
        // Filters for ebook only
        mediaWhere = [
          Sequelize.where(Sequelize.fn('json_array_length', Sequelize.col('audioFiles')), 0),
          {
            '$mediaProgresses.ebookProgress$': {
              [Sequelize.Op.gt]: 0
            }
          },
          {
            '$mediaProgresses.isFinished$': false
          }
        ]
      } else if (value === 'ebook-finished') {
        // Filters for ebook only
        mediaWhere = [
          Sequelize.where(Sequelize.fn('json_array_length', Sequelize.col('audioFiles')), 0),
          {
            '$mediaProgresses.isFinished$': true,
            ebookFile: {
              [Sequelize.Op.not]: null
            }
          }
        ]
      }
    } else if (group === 'series' && value === 'no-series') {
      mediaWhereHash['$series.id$'] = null
    } else if (group === 'abridged') {
      mediaWhereHash['abridged'] = true
    } else if (group === 'explicit') {
      mediaWhereHash['explicit'] = true
    } else if (['genres', 'tags', 'narrators'].includes(group)) {
      mediaWhereHash[group] = Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(${group}) WHERE json_valid(${group}) AND json_each.value = :filterValue)`), {
        [Sequelize.Op.gte]: 1
      })
      replacements.filterValue = value
    } else if (group === 'publishers') {
      mediaWhereHash['publisher'] = value
    } else if (group === 'languages') {
      mediaWhereHash['language'] = value
    } else if (group === 'tracks') {
      if (value === 'none') {
        mediaWhere = Sequelize.where(Sequelize.fn('json_array_length', Sequelize.col('audioFiles')), 0)
      } else if (value === 'multi') {
        mediaWhere = Sequelize.where(Sequelize.fn('json_array_length', Sequelize.col('audioFiles')), {
          [Sequelize.Op.gt]: 1
        })
      } else {
        mediaWhere = Sequelize.where(Sequelize.fn('json_array_length', Sequelize.col('audioFiles')), 1)
      }
    } else if (group === 'ebooks') {
      if (value === 'ebook') {
        mediaWhereHash['ebookFile'] = {
          [Sequelize.Op.not]: null
        }
      } else if (value == 'no-ebook') {
        mediaWhereHash['ebookFile'] = {
          [Sequelize.Op.eq]: null
        }
      }
    } else if (group === 'missing') {
      // includes() is false for a null value
      if (['asin', 'isbn', 'subtitle', 'publishedYear', 'description', 'publisher', 'language', 'cover'].includes(value as string)) {
        // value is one of the strings above
        let key = value as string
        if (value === 'cover') key = 'coverPath'
        mediaWhereHash[key] = {
          [Sequelize.Op.or]: [null, '']
        }
        // includes() is false for a null value
      } else if (['genres', 'tags', 'narrators', 'chapters'].includes(value as string)) {
        // value is one of the strings above
        const column = value as string
        mediaWhereHash[column] = {
          [Sequelize.Op.or]: [null, Sequelize.where(Sequelize.fn('json_array_length', Sequelize.col(column)), 0)]
        }
      } else if (value === 'authors') {
        mediaWhereHash['$authors.id$'] = null
      } else if (value === 'series') {
        mediaWhereHash['$series.id$'] = null
      }
    } else if (group === 'publishedDecades') {
      // parseInt(null) is NaN, as in the JS
      const startYear = parseInt(value as string)
      // parseInt(null) is NaN, as in the JS
      const endYear = parseInt(value as string, 10) + 9
      mediaWhere = Sequelize.where(Sequelize.literal('CAST(publishedYear AS INTEGER)'), {
        [Sequelize.Op.between]: [startYear, endYear]
      })
    }

    return { mediaWhere, replacements }
  },

  /**
   * Get sequelize order
   */
  getOrder(sortBy: string | null, sortDesc: boolean | null, collapseseries: boolean): QueryOrderItem[] {
    const dir = sortDesc ? 'DESC' : 'ASC'

    const getTitleOrder = (): [ReturnType<typeof Sequelize.literal>, string] => {
      if (global.ServerSettings.sortingIgnorePrefix) {
        return [Sequelize.literal('`libraryItem`.`titleIgnorePrefix` COLLATE NOCASE'), dir]
      } else {
        return [Sequelize.literal('`libraryItem`.`title` COLLATE NOCASE'), dir]
      }
    }

    if (sortBy === 'addedAt') {
      return [[Sequelize.literal('libraryItem.createdAt'), dir]]
    } else if (sortBy === 'size') {
      return [[Sequelize.literal('libraryItem.size'), dir]]
    } else if (sortBy === 'birthtimeMs') {
      return [[Sequelize.literal('libraryItem.birthtime'), dir]]
    } else if (sortBy === 'mtimeMs') {
      return [[Sequelize.literal('libraryItem.mtime'), dir]]
    } else if (sortBy === 'media.duration') {
      return [['duration', dir]]
    } else if (sortBy === 'media.metadata.publishedYear') {
      return [[Sequelize.literal(`CAST(\`book\`.\`publishedYear\` AS INTEGER)`), dir]]
    } else if (sortBy === 'media.metadata.authorNameLF') {
      // Sort by author name last first, secondary sort by title
      return [[Sequelize.literal('`libraryItem`.`authorNamesLastFirst` COLLATE NOCASE'), dir], getTitleOrder()]
    } else if (sortBy === 'media.metadata.authorName') {
      // Sort by author name first last, secondary sort by title
      return [[Sequelize.literal('`libraryItem`.`authorNamesFirstLast` COLLATE NOCASE'), dir], getTitleOrder()]
    } else if (sortBy === 'media.metadata.title') {
      if (collapseseries) {
        return [[Sequelize.literal('display_title COLLATE NOCASE'), dir]]
      }
      return [getTitleOrder()]
    } else if (sortBy === 'sequence') {
      const nullDir = sortDesc ? 'DESC NULLS FIRST' : 'ASC NULLS LAST'
      return [[Sequelize.literal(`CAST(\`series.bookSeries.sequence\` AS FLOAT) ${nullDir}`)]]
    } else if (sortBy === 'progress') {
      return [[Sequelize.literal(`mediaProgresses.updatedAt ${dir} NULLS LAST`)]]
    } else if (sortBy === 'progress.createdAt') {
      return [[Sequelize.literal(`mediaProgresses.createdAt ${dir} NULLS LAST`)]]
    } else if (sortBy === 'progress.finishedAt') {
      return [[Sequelize.literal(`mediaProgresses.finishedAt ${dir} NULLS LAST`)]]
    } else if (sortBy === 'random') {
      return [Database.sequelize.random()]
    }
    return []
  },

  /**
   * When collapsing series get first book in each series
   * to know which books to exclude from primary query.
   * Additionally use this query to get the number of books in each series
   *
   * @returns { booksToExclude, bookSeriesToInclude }
   */
  async getCollapseSeriesBooksToExclude(bookFindOptions: RuntimeFindOptions, seriesWhere: Record<string | symbol, unknown> | null, replacements: QueryReplacements = {}) {
    const allSeriesRows = await Database.seriesModel.findAll({
      attributes: ['id', 'name', [Sequelize.literal('(SELECT count(*) FROM bookSeries bs WHERE bs.seriesId = series.id)'), 'numBooks']],
      distinct: true,
      subQuery: false,
      replacements,
      where: seriesWhere,
      include: [
        {
          model: Database.bookModel,
          attributes: ['id', 'title'],
          through: {
            attributes: ['id', 'seriesId', 'bookId', 'sequence']
          },
          ...bookFindOptions,
          required: true
        }
      ],
      order: [Sequelize.literal('CAST(`books.bookSeries.sequence` AS FLOAT) ASC NULLS LAST')]
      // cast(b): checked as RuntimeFindOptions (the shapes Sequelize accepts at runtime); its FindOptions type is stricter; distinct is a count option, which findAll ignores
    } satisfies RuntimeFindOptions as FindOptions)
    // books (with their book_series row and libraryItem) are included above
    const allSeries = allSeriesRows as CollapseSeriesRow[]
    const bookSeriesToInclude: CollapseSeriesBookSeries[] = []
    const booksToInclude: string[] = []
    let booksToExclude: string[] = []
    allSeries.forEach((s) => {
      let found = false
      for (let book of s.books) {
        if (!found && !booksToInclude.includes(book.id)) {
          booksToInclude.push(book.id)
          bookSeriesToInclude.push({
            id: book.bookSeries.id,
            numBooks: s.dataValues.numBooks,
            libraryItemIds: s.books?.map((b) => b.libraryItem.id) || []
          })
          booksToExclude = booksToExclude.filter((bid) => bid !== book.id)
          found = true
        } else if (!booksToExclude.includes(book.id) && !booksToInclude.includes(book.id)) {
          booksToExclude.push(book.id)
        }
      }
    })
    return { booksToExclude, bookSeriesToInclude }
  },

  clearCountCache(hook: string) {
    Logger.debug(`[LibraryItemsBookFilters] book.${hook}: Clearing count cache`)
    countCache.clear()
  },

  async findAndCountAll(findOptions: RuntimeFindOptions, limit: number | null, offset: number | null, useCountCache: boolean): Promise<{ rows: Book[]; count: number }> {
    const model = Database.bookModel
    if (useCountCache) {
      const countCacheKey = stringifySequelizeQuery(findOptions)
      Logger.debug(`[LibraryItemsBookFilters] countCacheKey: ${countCacheKey}`)
      if (!countCache.has(countCacheKey)) {
        // cast(b): RuntimeFindOptions relaxes options to the shapes Sequelize accepts at runtime; its CountOptions type is stricter
        const count = await model.count(findOptions as CountOptions)
        countCache.set(countCacheKey, count)
      }

      findOptions.limit = limit || null
      // A null offset is passed through, as in the JS
      findOptions.offset = offset as number

      // cast(b): RuntimeFindOptions relaxes options to the shapes Sequelize accepts at runtime; its FindOptions type is stricter
      const rows = await model.findAll(findOptions as FindOptions)

      // Set above when missing
      return { rows, count: countCache.get(countCacheKey) as number }
    }

    findOptions.limit = limit || null
    // A null offset is passed through, as in the JS
    findOptions.offset = offset as number

    // cast(b): RuntimeFindOptions relaxes options to the shapes Sequelize accepts at runtime; its FindOptions type is stricter
    return await model.findAndCountAll(findOptions as FindOptions)
  },

  /**
   * Get library items for book media type using filter and sort
   * @param isHomePage for home page shelves
   */
  async getFilteredLibraryItems(
    libraryId: string,
    user: User | null | undefined,
    filterGroup: string | null | undefined,
    filterValue: string | null | undefined,
    sortBy: string | null,
    sortDesc: boolean | null,
    collapseseries: boolean,
    include: string[],
    limit: number | null,
    offset: number | null,
    isHomePage = false
  ): Promise<{ libraryItems: FilteredLibraryItem[]; count: number }> {
    // TODO: Handle collapse sub-series
    if (filterGroup === 'series' && collapseseries) {
      collapseseries = false
    }
    if (filterGroup !== 'series' && sortBy === 'sequence') {
      sortBy = 'media.metadata.title'
    }
    const includeRSSFeed = include.includes('rssfeed')
    const includeMediaItemShare = !!user?.isAdminOrUp && include.includes('share')

    // Typed by assertion so the null check below is not narrowed away
    let bookAttributes = null as { include: [ReturnType<typeof Sequelize.literal>, string][] } | null

    const libraryItemWhere: Record<string | symbol, unknown> = {
      libraryId
    }

    let seriesInclude: QueryInclude = {
      model: Database.bookSeriesModel,
      attributes: ['id', 'seriesId', 'sequence', 'createdAt'],
      include: {
        model: Database.seriesModel,
        attributes: ['id', 'name', 'nameIgnorePrefix']
      },
      order: [['createdAt', 'ASC']],
      separate: true
    }

    let authorInclude: QueryInclude = {
      model: Database.bookAuthorModel,
      attributes: ['authorId', 'createdAt'],
      include: {
        model: Database.authorModel,
        attributes: ['id', 'name']
      },
      order: [['createdAt', 'ASC']],
      separate: true
    }

    const sortOrder = this.getOrder(sortBy, sortDesc, collapseseries)

    const libraryItemIncludes: QueryInclude[] = []
    const bookIncludes: QueryInclude[] = []

    if (filterGroup === 'feed-open' || includeRSSFeed) {
      const rssFeedRequired = filterGroup === 'feed-open'
      libraryItemIncludes.push({
        model: Database.feedModel,
        required: rssFeedRequired,
        separate: !rssFeedRequired
      })
    }

    if (filterGroup === 'share-open') {
      bookIncludes.push({
        model: Database.mediaItemShareModel,
        required: true
      })
    } else if (filterGroup === 'ebooks' && filterValue === 'supplementary') {
      // TODO: Temp workaround for filtering supplementary ebook
      libraryItemWhere['libraryFiles'] = {
        [Sequelize.Op.substring]: `"isSupplementary":true`
      }
    } else if (filterGroup === 'ebooks' && filterValue === 'no-supplementary') {
      libraryItemWhere['libraryFiles'] = {
        [Sequelize.Op.notLike]: Sequelize.literal(`\'%"isSupplementary":true%\'`)
      }
    } else if (filterGroup === 'missing' && filterValue === 'authors') {
      authorInclude = {
        model: Database.authorModel,
        attributes: ['id'],
        through: {
          attributes: []
        }
      }
    } else if ((filterGroup === 'series' && filterValue === 'no-series') || (filterGroup === 'missing' && filterValue === 'series')) {
      seriesInclude = {
        model: Database.seriesModel,
        attributes: ['id'],
        through: {
          attributes: []
        }
      }
    } else if (filterGroup === 'authors') {
      bookIncludes.push({
        model: Database.authorModel,
        attributes: ['id', 'name'],
        where: {
          id: filterValue
        },
        through: {
          attributes: []
        }
      })
    } else if (filterGroup === 'series') {
      bookIncludes.push({
        model: Database.seriesModel,
        attributes: ['id', 'name'],
        where: {
          id: filterValue
        },
        through: {
          attributes: ['sequence']
        }
      })
      if (sortBy !== 'sequence') {
        // Secondary sort by sequence
        sortOrder.push([Sequelize.literal('CAST(`series.bookSeries.sequence` AS FLOAT) ASC NULLS LAST')])
      }
    } else if (filterGroup === 'issues') {
      libraryItemWhere[Sequelize.Op.or] = [
        {
          isMissing: true
        },
        {
          isInvalid: true
        }
      ]
    } else if (filterGroup === 'progress' && user) {
      const mediaProgressWhere: Record<string, unknown> = {
        userId: user.id
      }
      // Respect hide from continue listening for home page shelf
      if (isHomePage) {
        mediaProgressWhere.hideFromContinueListening = false
      }
      bookIncludes.push({
        model: Database.mediaProgressModel,
        attributes: ['id', 'isFinished', 'currentTime', 'ebookProgress', 'updatedAt', 'createdAt', 'finishedAt'],
        where: mediaProgressWhere,
        required: false
      })
    } else if (filterGroup === 'recent') {
      libraryItemWhere['createdAt'] = {
        [Sequelize.Op.gte]: new Date(new Date().valueOf() - 60 * 24 * 60 * 60 * 1000) // 60 days ago
      }
    }

    // When sorting by progress but not filtering by progress, include media progresses
    // includes() is false for a null sortBy
    if (filterGroup !== 'progress' && ['progress.createdAt', 'progress.finishedAt', 'progress'].includes(sortBy as string)) {
      bookIncludes.push({
        model: Database.mediaProgressModel,
        attributes: ['id', 'isFinished', 'currentTime', 'ebookProgress', 'updatedAt', 'createdAt', 'finishedAt'],
        where: {
          // Sorting by progress is only requested with a user
          userId: (user as User).id
        },
        required: false
      })
    }

    let { mediaWhere, replacements } = this.getMediaGroupQuery(filterGroup, filterValue)
    let bookWhere: (WhereItem | Record<string | symbol, unknown>)[] = Array.isArray(mediaWhere) ? mediaWhere : [mediaWhere]

    // User permissions
    const userPermissionBookWhere = this.getUserPermissionBookWhereQuery(user)
    replacements = { ...replacements, ...userPermissionBookWhere.replacements }
    bookWhere.push(...userPermissionBookWhere.bookWhere)

    // Handle collapsed series
    let collapseSeriesBookSeries: CollapseSeriesBookSeries[] = []
    if (collapseseries) {
      let seriesBookWhere: typeof bookWhere | null = null
      let seriesWhere: Record<string | symbol, unknown> | null = null
      if (filterGroup === 'progress') {
        seriesWhere = this.getCollapseSeriesMediaProgressFilter(filterValue)
      } else if (filterGroup === 'missing' && filterValue === 'authors') {
        seriesWhere = {
          ['$books.authors.id$']: null
        }
      } else {
        seriesBookWhere = bookWhere
      }

      const bookFindOptions: RuntimeFindOptions = {
        where: seriesBookWhere,
        include: [
          {
            model: Database.libraryItemModel,
            required: true,
            where: libraryItemWhere,
            include: libraryItemIncludes
          },
          authorInclude,
          ...bookIncludes
        ]
      }
      const { booksToExclude, bookSeriesToInclude } = await this.getCollapseSeriesBooksToExclude(bookFindOptions, seriesWhere, replacements)
      if (booksToExclude.length) {
        bookWhere.push({
          id: {
            [Sequelize.Op.notIn]: booksToExclude
          }
        })
      }
      collapseSeriesBookSeries = bookSeriesToInclude
      if (!bookAttributes?.include) bookAttributes = { include: [] }

      // When collapsing series and sorting by title then use the series name instead of the book title
      //  for this set an attribute "display_title" to use in sorting
      if (global.ServerSettings.sortingIgnorePrefix) {
        bookAttributes.include.push([Sequelize.literal(`IFNULL((SELECT s.nameIgnorePrefix FROM bookSeries AS bs, series AS s WHERE bs.seriesId = s.id AND bs.bookId = book.id AND bs.id IN (${bookSeriesToInclude.map((v) => `"${v.id}"`).join(', ')})), \`libraryItem\`.\`titleIgnorePrefix\`)`), 'display_title'])
      } else {
        bookAttributes.include.push([Sequelize.literal(`IFNULL((SELECT s.name FROM bookSeries AS bs, series AS s WHERE bs.seriesId = s.id AND bs.bookId = book.id AND bs.id IN (${bookSeriesToInclude.map((v) => `"${v.id}"`).join(', ')})), \`libraryItem\`.\`title\`)`), 'display_title'])
      }
    }

    const findOptions: RuntimeFindOptions = {
      where: bookWhere,
      distinct: true,
      attributes: bookAttributes,
      replacements,
      include: [
        {
          model: Database.libraryItemModel,
          required: true,
          where: libraryItemWhere,
          include: libraryItemIncludes
        },
        seriesInclude,
        authorInclude,
        ...bookIncludes
      ],
      order: sortOrder,
      subQuery: false
    }

    const findAndCountAll = process.env.QUERY_PROFILING ? profile(this.findAndCountAll) : this.findAndCountAll
    const { rows: books, count } = await findAndCountAll(findOptions, limit, offset, !filterGroup && !userPermissionBookWhere.bookWhere.length)

    // The rows are books with the includes above
    const libraryItems = (books as BookRow[]).map((bookExpanded) => {
      // libraryItem is a required include
      const libraryItem = bookExpanded.libraryItem as FilteredLibraryItem
      const book = bookExpanded

      if (filterGroup === 'series' && book.series?.length) {
        // For showing sequence on book cover when filtering for series
        libraryItem.series = {
          id: book.series[0].id,
          name: book.series[0].name,
          sequence: book.series[0].bookSeries?.sequence || null
        }
      }

      delete book.libraryItem

      book.series =
        book.bookSeries?.map((bs) => {
          // series is included through bookSeries
          const series = bs.series as SeriesRow
          delete bs.series
          series.bookSeries = bs
          return series
        }) || []
      delete book.bookSeries

      book.authors = book.bookAuthors?.map((ba) => ba.author) || []
      delete book.bookAuthors

      // For showing details of collapsed series
      if (collapseseries && book.series?.length) {
        const collapsedSeries = book.series.find((bs) => collapseSeriesBookSeries.some((cbs) => cbs.id === bs.bookSeries.id))
        if (collapsedSeries) {
          const collapseSeriesObj = collapseSeriesBookSeries.find((csbs) => csbs.id === collapsedSeries.bookSeries.id)
          libraryItem.collapsedSeries = {
            id: collapsedSeries.id,
            name: collapsedSeries.name,
            nameIgnorePrefix: collapsedSeries.nameIgnorePrefix,
            sequence: collapsedSeries.bookSeries.sequence,
            numBooks: collapseSeriesObj?.numBooks || 0,
            libraryItemIds: collapseSeriesObj?.libraryItemIds || []
          }
        }
      }

      if (libraryItem.feeds?.length) {
        libraryItem.rssFeed = libraryItem.feeds[0]
      }

      if (includeMediaItemShare) {
        libraryItem.mediaItemShare = ShareManager.findByMediaItemId(libraryItem.mediaId)
      }


      // cast(d): series and authors were set from bookSeries and bookAuthors above
      libraryItem.media = book as Book

      return libraryItem
    })

    return {
      libraryItems,
      count
    }
  },

  /**
   * Get library items for continue series shelf
   * A series is included on the shelf if it meets the following:
   * 1. Has at least 1 finished book
   * 2. Has no books in progress
   * 3. Has at least 1 unfinished book
   * TODO: Reduce queries
   */
  async getContinueSeriesLibraryItems(library: Library, user: User, include: string[], limit: number, offset: number) {
    const libraryId = library.id
    const libraryItemIncludes: QueryInclude[] = []
    if (include.includes('rssfeed')) {
      libraryItemIncludes.push({
        model: Database.feedModel
      })
    }

    const bookWhere: WhereItem[] = []
    // TODO: Permissions should also be applied to subqueries
    // User permissions
    const userPermissionBookWhere = this.getUserPermissionBookWhereQuery(user)
    bookWhere.push(...userPermissionBookWhere.bookWhere)

    let includeAttributes: [ReturnType<typeof Sequelize.literal>, string][] = [[Sequelize.literal('(SELECT max(mp.updatedAt) FROM bookSeries bs, mediaProgresses mp WHERE mp.mediaItemId = bs.bookId AND mp.userId = :userId AND bs.seriesId = series.id)'), 'recent_progress']]
    let booksNotFinishedQuery = `SELECT count(*) FROM bookSeries bs LEFT OUTER JOIN mediaProgresses mp ON mp.mediaItemId = bs.bookId AND mp.userId = :userId WHERE bs.seriesId = series.id AND (mp.isFinished = 0 OR mp.isFinished IS NULL)`

    if (library.settings.onlyShowLaterBooksInContinueSeries) {
      const maxSequenceQuery = `(SELECT CAST(max(bs.sequence) as FLOAT) FROM bookSeries bs, mediaProgresses mp WHERE mp.mediaItemId = bs.bookId AND mp.isFinished = 1 AND mp.userId = :userId AND bs.seriesId = series.id)`
      includeAttributes.push([Sequelize.literal(`${maxSequenceQuery}`), 'maxSequence'])

      booksNotFinishedQuery = booksNotFinishedQuery + ` AND CAST(bs.sequence as FLOAT) > ${maxSequenceQuery}`
    }

    const { rows: series, count } = await Database.seriesModel.findAndCountAll({
      where: [
        {
          id: {
            // extraData is a JSON column
            [Sequelize.Op.notIn]: (user.extraData as { seriesHideFromContinueListening?: string[] } | null)?.seriesHideFromContinueListening || []
          },
          libraryId
        },
        // TODO: Simplify queries
        // Has at least 1 book finished
        Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM mediaProgresses mp, bookSeries bs WHERE bs.seriesId = series.id AND mp.mediaItemId = bs.bookId AND mp.userId = :userId AND mp.isFinished = 1)`), {
          [Sequelize.Op.gte]: 1
        }),
        // Has at least 1 book not finished (that has a sequence number higher than the highest already read, if library config is toggled)
        Sequelize.where(Sequelize.literal(`(${booksNotFinishedQuery})`), {
          [Sequelize.Op.gte]: 1
        }),
        // Has no books in progress
        Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM mediaProgresses mp, bookSeries bs WHERE mp.mediaItemId = bs.bookId AND mp.userId = :userId AND bs.seriesId = series.id AND mp.isFinished = 0 AND mp.currentTime > 0)`), 0)
      ],
      attributes: {
        include: includeAttributes
      },
      replacements: {
        userId: user.id,
        ...userPermissionBookWhere.replacements
      },
      include: {
        model: Database.bookSeriesModel,
        attributes: ['bookId', 'sequence'],
        separate: true,
        subQuery: false,
        order: [[Sequelize.literal('CAST(sequence AS FLOAT) ASC NULLS LAST')]],
        where: {
          '$book.mediaProgresses.isFinished$': {
            [Sequelize.Op.or]: [null, 0]
          }
        },
        include: {
          model: Database.bookModel,
          where: bookWhere,
          include: [
            {
              model: Database.libraryItemModel,
              include: libraryItemIncludes
            },
            {
              model: Database.authorModel,
              through: {
                attributes: []
              }
            },
            {
              model: Database.mediaProgressModel,
              where: {
                userId: user.id
              },
              required: false
            }
          ]
        }
      },
      order: [[Sequelize.literal('recent_progress DESC')]],
      distinct: true,
      subQuery: false,
      limit,
      offset
      // cast(b): checked as RuntimeFindOptions (the shapes Sequelize accepts at runtime); its FindAndCountOptions type is stricter, and TypeScript does not compare the nested single include objects of the literal with it
    } satisfies RuntimeFindOptions as unknown as FindAndCountOptions)

    // bookSeries (with book, libraryItem, authors and progress) is included above
    const libraryItems = (series as SeriesWithBookSeries[])
      .map((s) => {
        if (!s.bookSeries.length) return null // this is only possible if user has restricted books in series

        let bookIndex = 0
        // if the library setting is toggled, only show later entries in series, otherwise skip
        if (library.settings.onlyShowLaterBooksInContinueSeries) {
          bookIndex = s.bookSeries.findIndex(function (b) {
            // cast(d): parseFloat(null) is NaN, as in the JS
            return parseFloat(b.dataValues.sequence as string) > s.dataValues.maxSequence
          })
          if (bookIndex === -1) {
            // no later books than maxSequence
            return null
          }
        }

        // libraryItem is included above
        const libraryItem = s.bookSeries[bookIndex].book.libraryItem as FilteredLibraryItem
        const book = s.bookSeries[bookIndex].book
        delete book.libraryItem

        book.series = []

        libraryItem.series = {
          id: s.id,
          name: s.name,
          sequence: s.bookSeries[bookIndex].sequence
        }
        if (libraryItem.feeds?.length) {
          libraryItem.rssFeed = libraryItem.feeds[0]
        }
        libraryItem.media = book
        return libraryItem
      })
      .filter((s): s is FilteredLibraryItem => !!s)

    return {
      libraryItems,
      count
    }
  },

  /**
   * Get book library items for the "Discover" shelf
   * Random selection of books that are not started
   *  - only includes the first book of a not-started series
   */
  async getDiscoverLibraryItems(libraryId: string, user: User, include: string[], limit: number) {
    const userPermissionBookWhere = this.getUserPermissionBookWhereQuery(user)

    // Step 1: Get the first book of every series that hasnt been started yet
    const seriesNotStarted = await Database.seriesModel.findAll({
      where: [
        {
          libraryId
        },
        Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM bookSeries bs LEFT OUTER JOIN mediaProgresses mp ON mp.mediaItemId = bs.bookId WHERE bs.seriesId = series.id AND mp.userId = :userId AND (mp.isFinished = 1 OR mp.currentTime > 0))`), 0)
      ],
      replacements: {
        userId: user.id,
        ...userPermissionBookWhere.replacements
      },
      attributes: ['id'],
      include: {
        model: Database.bookSeriesModel,
        attributes: ['bookId', 'sequence'],
        separate: true,
        required: true,
        include: {
          model: Database.bookModel,
          where: userPermissionBookWhere.bookWhere
        },
        order: [[Sequelize.literal('CAST(sequence AS FLOAT) ASC NULLS LAST')]],
        limit: 1
      },
      subQuery: false,
      limit,
      order: Database.sequelize.random()
      // cast(b): checked as RuntimeFindOptions (the shapes Sequelize accepts at runtime); its FindOptions type is stricter, and TypeScript does not compare the nested single include objects of the literal with it
    } satisfies RuntimeFindOptions as unknown as FindOptions)

    // bookSeries is included above
    const booksFromSeriesToInclude = (seriesNotStarted as SeriesWithBookSeries[]).map((se) => se.bookSeries?.[0]?.bookId).filter((bid) => bid)

    // optional include rssFeed
    const libraryItemIncludes: QueryInclude[] = []
    if (include.includes('rssfeed')) {
      libraryItemIncludes.push({
        model: Database.feedModel
      })
    }

    const discoverWhere = [
      {
        '$mediaProgresses.isFinished$': {
          [Sequelize.Op.or]: [null, 0]
        },
        '$mediaProgresses.currentTime$': {
          [Sequelize.Op.or]: [null, 0]
        },
        [Sequelize.Op.or]: [
          Sequelize.where(Sequelize.literal(`(SELECT COUNT(*) FROM bookSeries bs where bs.bookId = book.id)`), 0),
          {
            id: {
              [Sequelize.Op.in]: booksFromSeriesToInclude
            }
          }
        ]
      },
      ...userPermissionBookWhere.bookWhere
    ]

    const baseDiscoverInclude = [
      {
        model: Database.libraryItemModel,
        where: {
          libraryId
        }
      },
      {
        model: Database.mediaProgressModel,
        where: {
          userId: user.id
        },
        required: false
      }
    ]

    // Step 2a: Count with lightweight includes only
    const count = await Database.bookModel.count({
      where: discoverWhere,
      replacements: userPermissionBookWhere.replacements,
      include: baseDiscoverInclude,
      distinct: true,
      col: 'id',
      subQuery: false
      // cast(b): checked as RuntimeFindOptions with the count option col (the shapes Sequelize accepts at runtime); its CountOptions type is stricter
    } satisfies RuntimeFindOptions & Pick<CountOptions, 'col'> as CountOptions)

    // Step 2b: Select random IDs with lightweight includes only
    const randomSelection = await Database.bookModel.findAll({
      attributes: ['id'],
      where: discoverWhere,
      replacements: userPermissionBookWhere.replacements,
      include: baseDiscoverInclude,
      subQuery: false,
      distinct: true,
      limit,
      order: Database.sequelize.random()
      // cast(b): checked as RuntimeFindOptions (the shapes Sequelize accepts at runtime); its FindOptions type is stricter; distinct is a count option, which findAll ignores
    } satisfies RuntimeFindOptions as FindOptions)

    const selectedIds = randomSelection.map((b) => b.id).filter(Boolean)
    if (!selectedIds.length) {
      return {
        libraryItems: [],
        count
      }
    }

    // Step 2c: Hydrate selected IDs with full metadata for API response
    const books = await Database.bookModel.findAll({
      where: {
        id: {
          [Sequelize.Op.in]: selectedIds
        }
      },
      include: [
        {
          model: Database.libraryItemModel,
          where: {
            libraryId
          },
          include: libraryItemIncludes
        },
        {
          model: Database.bookAuthorModel,
          attributes: ['authorId'],
          include: {
            model: Database.authorModel
          },
          separate: true
        },
        {
          model: Database.bookSeriesModel,
          attributes: ['seriesId', 'sequence'],
          include: {
            model: Database.seriesModel
          },
          separate: true
        }
      ],
      subQuery: false
      // cast(b): checked as RuntimeFindOptions (the shapes Sequelize accepts at runtime); its FindOptions type is stricter
    } satisfies RuntimeFindOptions as FindOptions)

    const booksById = new Map(books.map((b) => [b.id, b]))
    // Books with the includes above; filter(Boolean) removes ids that were not found
    const orderedBooks = selectedIds.map((id) => booksById.get(id)).filter(Boolean) as BookRow[]

    // Step 3: Map books to library items
    const libraryItems = orderedBooks.map((bookExpanded) => {
      // libraryItem is included above
      const libraryItem = bookExpanded.libraryItem as FilteredLibraryItem
      const book = bookExpanded
      delete book.libraryItem

      book.series =
        book.bookSeries?.map((bs) => {
          // series is included through bookSeries
          const series = bs.series as SeriesRow
          delete bs.series
          series.bookSeries = bs
          return series
        }) || []
      delete book.bookSeries

      book.authors = book.bookAuthors?.map((ba) => ba.author) || []
      delete book.bookAuthors


      // cast(d): series and authors were set from bookSeries and bookAuthors above
      libraryItem.media = book as Book

      if (libraryItem.feeds?.length) {
        libraryItem.rssFeed = libraryItem.feeds[0]
      }

      return libraryItem
    })

    return {
      libraryItems,
      count
    }
  },

  /**
   * Get book library items in a collection
   * @param collection old collection
   */
  async getLibraryItemsForCollection(collection: { books?: string[] } | null | undefined): Promise<FilteredLibraryItem[]> {
    if (!collection?.books?.length) {
      Logger.error(`[libraryItemsBookFilters] Invalid collection`, collection)
      return []
    }

    const books = await Database.bookModel.findAll({
      include: [
        {
          model: Database.libraryItemModel,
          where: {
            id: {
              [Sequelize.Op.in]: collection.books
            }
          }
        },
        {
          model: Database.authorModel,
          through: {
            attributes: []
          }
        },
        {
          model: Database.seriesModel,
          through: {
            attributes: ['sequence']
          }
        }
      ]
    })

    // libraryItem is included above
    return books.map((book) => {
      // libraryItem is a required include
      const libraryItem = book.libraryItem as FilteredLibraryItem
      delete book.libraryItem
      libraryItem.media = book
      return libraryItem
    })
  },

  /**
   * Get library items for series
   */
  async getLibraryItemsForSeries(series: Series, user?: User): Promise<FilteredLibraryItem[]> {
    const { libraryItems } = await this.getFilteredLibraryItems(series.libraryId, user, 'series', series.id, null, null, false, [], null, null)
    return libraryItems
  },

  /**
   * Search books, authors, series
   */
  async search(user: User, library: Library, query: string, limit: number, offset: number) {
    const userPermissionBookWhere = this.getUserPermissionBookWhereQuery(user)

    const textSearchQuery = await Database.createTextSearchQuery(query)

    const matchTitle = textSearchQuery.matchExpression('book.title')
    const matchSubtitle = textSearchQuery.matchExpression('book.subtitle')

    // Search title, subtitle, asin, isbn
    const books = await Database.bookModel.findAll({
      where: [
        {
          [Sequelize.Op.or]: [
            Sequelize.literal(matchTitle),
            Sequelize.literal(matchSubtitle),
            {
              asin: {
                [Sequelize.Op.substring]: query
              }
            },
            {
              isbn: {
                [Sequelize.Op.substring]: query
              }
            }
          ]
        },
        ...userPermissionBookWhere.bookWhere
      ],
      replacements: userPermissionBookWhere.replacements,
      include: [
        {
          model: Database.libraryItemModel,
          where: {
            libraryId: library.id
          }
        },
        {
          model: Database.bookSeriesModel,
          include: {
            model: Database.seriesModel
          },
          separate: true
        },
        {
          model: Database.bookAuthorModel,
          include: {
            model: Database.authorModel
          },
          separate: true
        }
      ],
      subQuery: false,
      distinct: true,
      limit,
      offset
      // cast(b): checked as RuntimeFindOptions (the shapes Sequelize accepts at runtime); its FindOptions type is stricter; distinct is a count option, which findAll ignores
    } satisfies RuntimeFindOptions as FindOptions)

    const itemMatches: { libraryItem: ReturnType<LibraryItem['toOldJSONExpanded']> }[] = []

    // libraryItem, bookSeries and bookAuthors are included above
    for (const book of books as BookRow[]) {
      // libraryItem is a required include
      const libraryItem = book.libraryItem as FilteredLibraryItem
      delete book.libraryItem

      // bookSeries is a separate include, so it is always an array
      book.series = (book.bookSeries as BookSeriesRow[]).map((bs) => {
        // series is included through bookSeries
        const series = bs.series as SeriesRow
        delete bs.series
        series.bookSeries = bs
        return series
      })
      delete book.bookSeries

      // bookAuthors is a separate include, so it is always an array
      book.authors = (book.bookAuthors as BookAuthorRow[]).map((ba) => ba.author)
      delete book.bookAuthors


      // cast(d): series and authors were set from bookSeries and bookAuthors above
      libraryItem.media = book as Book
      itemMatches.push({
        libraryItem: libraryItem.toOldJSONExpanded()
      })
    }

    const matchJsonValue = textSearchQuery.matchExpression('json_each.value')

    // Search narrators
    const narratorMatches: Record<string, unknown>[] = []
    const [narratorResultRows] = await Database.sequelize.query(`SELECT value, count(*) AS numBooks FROM books b, libraryItems li, json_each(b.narrators) WHERE json_valid(b.narrators) AND ${matchJsonValue} AND b.id = li.mediaId AND li.libraryId = :libraryId GROUP BY value LIMIT :limit OFFSET :offset;`, {
      replacements: {
        libraryId: library.id,
        limit,
        offset
      },
      raw: true
    })
    // Rows of the query above
    for (const row of narratorResultRows as ValueCountRow[]) {
      narratorMatches.push({
        name: row.value,
        numBooks: row.numBooks
      })
    }

    // Search tags
    const tagMatches: Record<string, unknown>[] = []
    const [tagResultRows] = await Database.sequelize.query(`SELECT value, count(*) AS numItems FROM books b, libraryItems li, json_each(b.tags) WHERE json_valid(b.tags) AND ${matchJsonValue} AND b.id = li.mediaId AND li.libraryId = :libraryId GROUP BY value ORDER BY numItems DESC LIMIT :limit OFFSET :offset;`, {
      replacements: {
        libraryId: library.id,
        limit,
        offset
      },
      raw: true
    })
    // Rows of the query above
    for (const row of tagResultRows as ValueCountRow[]) {
      tagMatches.push({
        name: row.value,
        numItems: row.numItems
      })
    }

    // Search genres
    const genreMatches: Record<string, unknown>[] = []
    const [genreResultRows] = await Database.sequelize.query(`SELECT value, count(*) AS numItems FROM books b, libraryItems li, json_each(b.genres) WHERE json_valid(b.genres) AND ${matchJsonValue} AND b.id = li.mediaId AND li.libraryId = :libraryId GROUP BY value ORDER BY numItems DESC LIMIT :limit OFFSET :offset;`, {
      replacements: {
        libraryId: library.id,
        limit,
        offset
      },
      raw: true
    })
    // Rows of the query above
    for (const row of genreResultRows as ValueCountRow[]) {
      genreMatches.push({
        name: row.value,
        numItems: row.numItems
      })
    }

    // Search series
    const matchName = textSearchQuery.matchExpression('name')
    const allSeries = await Database.seriesModel.findAll({
      where: {
        [Sequelize.Op.and]: [
          Sequelize.literal(matchName),
          {
            libraryId: library.id
          }
        ]
      },
      replacements: userPermissionBookWhere.replacements,
      include: {
        separate: true,
        model: Database.bookSeriesModel,
        include: {
          model: Database.bookModel,
          where: userPermissionBookWhere.bookWhere,
          include: {
            model: Database.libraryItemModel
          }
        }
      },
      subQuery: false,
      distinct: true,
      limit,
      offset
      // cast(b): checked as RuntimeFindOptions (the shapes Sequelize accepts at runtime); its FindOptions type is stricter, and TypeScript does not compare the nested single include objects of the literal with it; distinct is a count option, which findAll ignores
    } satisfies RuntimeFindOptions as unknown as FindOptions)
    const seriesMatches: { series: ReturnType<Series['toOldJSON']>; books: ReturnType<LibraryItem['toOldJSON']>[] }[] = []
    // bookSeries (with book and libraryItem) is included above
    for (const series of allSeries as SeriesWithBookSeries[]) {
      const books = series.bookSeries.map((bs) => {
        // libraryItem is included above
        const libraryItem = bs.book.libraryItem as FilteredLibraryItem
        libraryItem.media = bs.book
        // media is the book set above
        ;(libraryItem.media as BookExpanded).authors = []
        // media is the book set above
        ;(libraryItem.media as BookExpanded).series = []
        return libraryItem.toOldJSON()
      })
      if (books.length) {
        seriesMatches.push({
          series: series.toOldJSON(),
          books
        })
      }
    }

    // Search authors
    const authorMatches = await authorFilters.search(library.id, textSearchQuery, limit, offset)

    return {
      book: itemMatches,
      narrators: narratorMatches,
      tags: tagMatches,
      genres: genreMatches,
      series: seriesMatches,
      authors: authorMatches
    }
  },

  /**
   * Genres with num books
   */
  async getGenresWithCount(libraryId: string): Promise<{ genre: string; count: number }[]> {
    const genres: { genre: string; count: number }[] = []
    const [genreResultRows] = await Database.sequelize.query(`SELECT value, count(*) AS numItems FROM books b, libraryItems li, json_each(b.genres) WHERE json_valid(b.genres) AND b.id = li.mediaId AND li.libraryId = :libraryId GROUP BY value ORDER BY numItems DESC;`, {
      replacements: {
        libraryId
      },
      raw: true
    })
    // Rows of the query above
    for (const row of genreResultRows as ValueCountRow[]) {
      genres.push({
        genre: row.value,
        count: row.numItems
      })
    }
    return genres
  },

  /**
   * Get stats for book library
   */
  async getBookLibraryStats(libraryId: string): Promise<{ totalSize: number; totalDuration: number; numAudioFiles: number; totalItems: number }> {
    const [statResultRows] = await Database.sequelize.query(`SELECT SUM(li.size) AS totalSize, SUM(b.duration) AS totalDuration, SUM(json_array_length(b.audioFiles)) AS numAudioFiles, COUNT(*) AS totalItems FROM libraryItems li, books b WHERE b.id = li.mediaId AND li.libraryId = :libraryId;`, {
      replacements: {
        libraryId
      }
    })
    // Rows of the query above
    const statResults = statResultRows as { totalSize: number | null; totalDuration: number | null; numAudioFiles: number | null; totalItems: number }[]
    return {
      totalSize: statResults?.[0]?.totalSize || 0,
      totalDuration: statResults?.[0]?.totalDuration || 0,
      numAudioFiles: statResults?.[0]?.numAudioFiles || 0,
      totalItems: statResults?.[0]?.totalItems || 0
    }
  },

  /**
   * Get longest books in library
   */
  async getLongestBooks(libraryId: string, limit: number): Promise<{ id: string; title: string | null; duration: number }[]> {
    const books = await Database.bookModel.findAll({
      attributes: ['id', 'title', 'duration'],
      include: {
        model: Database.libraryItemModel,
        attributes: ['id', 'libraryId'],
        where: {
          libraryId
        }
      },
      order: [['duration', 'DESC']],
      limit
    })
    // libraryItem is included above
    return (books as (Book & { libraryItem: LibraryItem })[]).map((book) => {
      return {
        id: book.libraryItem.id,
        title: book.title,
        duration: book.duration
      }
    })
  }
}
