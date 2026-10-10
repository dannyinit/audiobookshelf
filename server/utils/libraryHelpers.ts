import fastSort = require('../libs/fastSort')
import Database = require('../Database')
import Logger = require('../Logger')
import utils = require('../utils/index')
import LibraryItem = require('../models/LibraryItem')
import User = require('../models/User')
import Library = require('../models/Library')
import type { SortByObject, SortInstance } from './types'
const { createNewSortInstance } = fastSort

const { getTitlePrefixAtEnd, isNullOrNaN, getTitleIgnorePrefix } = utils
// cast(a): the vendored fast-sort has untyped parameters (see SortInstance)
const naturalSort = createNewSortInstance({
  comparer: new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
}) as SortInstance

type BookExpanded = import('../models/Book').BookExpanded

/**
 * Series included through the book with its book_series join row
 */
type SeriesExpanded = import('../models/Series') & { bookSeries: { sequence: string } }

type BookMediaExpanded = Omit<BookExpanded, 'series'> & { series: SeriesExpanded[] }

/**
 * Minified old library item json of a book, with the series sequences added by getSeriesFromBooks
 */
type SeriesBookJson = ReturnType<LibraryItem['toOldJSONMinified']> & {
  media: { duration?: number }
  sequence?: string | null
  filterSeriesSequence?: string | null
}

/**
 * Book library item with expanded media. The series helpers are only called with book library items
 */
type BookLibraryItem = Omit<LibraryItem, 'media'> & {
  media: BookMediaExpanded
  collapsedSeries?: SeriesWithBooks
  authorNamesFirstLast?: string
  authorNamesLastFirst?: string
}

/**
 * Minified old library item json returned by handleCollapseSubseries
 */
type CollapsedItemJson = ReturnType<LibraryItem['toOldJSONMinified']> & {
  media: { metadata: { series?: { id: string; name: string; sequence: string } } }
  collapsedSeries?: {
    id: string
    name: string
    nameIgnorePrefix: string | null | undefined
    libraryItemIds: string[]
    numBooks: number
    seriesSequenceList?: string
  }
}

interface SequenceRange {
  start: string | number
  end: string | number
  isNumber: boolean
}

interface SeriesWithBooks {
  id: string
  name: string
  nameIgnorePrefix: string | null | undefined
  nameIgnorePrefixSort: string
  type: 'series'
  books: SeriesBookJson[]
  totalDuration: number
}

/**
 * Library item that may have a collapsed series attached (clone made in collapseBookSeries)
 */
type CollapsedLibraryItem = BookLibraryItem

/**
 * Request payload used by the library items endpoint (only the fields used)
 */
interface CollapseSubseriesPayload {
  sortBy?: string
  sortDesc?: boolean
  limit?: number
  page?: number
  total?: number
}

const VALID_COLLAPSE_SUBSERIES_SORTS = new Set(['addedAt', 'size', 'birthtimeMs', 'mtimeMs', 'media.duration', 'media.metadata.publishedYear', 'media.metadata.authorName', 'media.metadata.authorNameLF', 'media.metadata.title', 'sequence', 'progress', 'progress.createdAt', 'progress.finishedAt', 'random'])

const libraryHelpers = {
  getSeriesFromBooks(libraryItems: BookLibraryItem[], filterSeries: string | null | undefined, hideSingleBookSeries: boolean | null | undefined) {
    const _series: Record<string, SeriesWithBooks> = {}
    const seriesToFilterOut: Record<string, boolean> = {}
    libraryItems.forEach((libraryItem) => {
      // get all book series for item that is not already filtered out
      const allBookSeries = (libraryItem.media.series || []).filter((se) => !seriesToFilterOut[se.id])
      if (!allBookSeries.length) return

      allBookSeries.forEach((bookSeries) => {
        // cast(d): toOldJSONMinified of a book library item; SeriesBookJson adds the sequence fields set below
        const abJson = libraryItem.toOldJSONMinified() as SeriesBookJson
        abJson.sequence = bookSeries.bookSeries.sequence
        if (filterSeries) {
          // cast(d): find is typed as possibly undefined; the items are the books of filterSeries (see handleCollapseSubseries), so the series is found
          const series = libraryItem.media.series.find((se) => se.id === filterSeries) as SeriesExpanded
          abJson.filterSeriesSequence = series.bookSeries.sequence
        }
        if (!_series[bookSeries.id]) {
          _series[bookSeries.id] = {
            id: bookSeries.id,
            name: bookSeries.name,
            nameIgnorePrefix: getTitlePrefixAtEnd(bookSeries.name),
            nameIgnorePrefixSort: getTitleIgnorePrefix(bookSeries.name),
            type: 'series',
            books: [abJson],
            totalDuration: isNullOrNaN(abJson.media.duration) ? 0 : Number(abJson.media.duration)
          }
        } else {
          _series[bookSeries.id].books.push(abJson)
          _series[bookSeries.id].totalDuration += isNullOrNaN(abJson.media.duration) ? 0 : Number(abJson.media.duration)
        }
      })
    })

    let seriesItems = Object.values(_series)

    // Library setting to hide series with only 1 book
    if (hideSingleBookSeries) {
      seriesItems = seriesItems.filter((se) => se.books.length > 1)
    }

    return seriesItems.map((series) => {
      series.books = naturalSort(series.books).asc((li) => li.sequence)
      return series
    })
  },

  /**
   * @param filterSeries - series id
   */
  collapseBookSeries(libraryItems: BookLibraryItem[], filterSeries: string | null | undefined, hideSingleBookSeries: boolean | null | undefined): CollapsedLibraryItem[] {
    // Get series from the library items. If this list is being collapsed after filtering for a series,
    // don't collapse that series, only books that are in other series.
    const seriesObjects = libraryHelpers.getSeriesFromBooks(libraryItems, filterSeries, hideSingleBookSeries).filter((s) => s.id != filterSeries)

    const filteredLibraryItems: CollapsedLibraryItem[] = []

    libraryItems.forEach((li) => {
      if (li.mediaType != 'book') return

      // Handle when this is the first book in a series
      seriesObjects
        .filter((s) => s.books[0].id == li.id)
        .forEach((series) => {
          // Clone the library item as we need to attach data to it, but don't
          // want to change the global copy of the library item
          filteredLibraryItems.push(Object.assign(Object.create(Object.getPrototypeOf(li)), li, { collapsedSeries: series }))
        })

      // Only included books not contained in series
      if (!seriesObjects.some((s) => s.books.some((b) => b.id == li.id))) filteredLibraryItems.push(li)
    })

    return filteredLibraryItems
  },

  async handleCollapseSubseries(payload: CollapseSubseriesPayload, seriesId: string, user: User, library: Library) {
    if (payload.sortBy && !VALID_COLLAPSE_SUBSERIES_SORTS.has(payload.sortBy)) {
      Logger.warn(`[libraryHelpers] Invalid "sort" query string "${payload.sortBy}"`)
      payload.sortBy = undefined
    }

    const seriesWithBooks = await Database.seriesModel.findByPk(seriesId, {
      include: {
        model: Database.bookModel,
        through: {
          attributes: ['sequence']
        },
        include: [
          {
            model: Database.libraryItemModel
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
      }
    })
    if (!seriesWithBooks) {
      payload.total = 0
      return []
    }

    // cast(b): Sequelize types the include as Book[]; the series is loaded with its books, each with its library item, authors and series
    const books = seriesWithBooks.books as (BookMediaExpanded & { libraryItem?: BookLibraryItem })[]
    payload.total = books.length

    let libraryItems = books
      .map((book) => {
        // cast(b): libraryItem is included in the query above; typed optional so it can be deleted below
        const libraryItem = book.libraryItem as BookLibraryItem
        delete book.libraryItem
        libraryItem.media = book
        return libraryItem
      })
      .filter((li) => {
        return user.checkCanAccessLibraryItem(li)
      })

    const collapsedItems = libraryHelpers.collapseBookSeries(libraryItems, seriesId, library.settings.hideSingleBookSeries)
    if (!(collapsedItems.length == 1 && collapsedItems[0].collapsedSeries)) {
      libraryItems = collapsedItems
      payload.total = libraryItems.length
    }

    const sortingIgnorePrefix = Database.serverSettings.sortingIgnorePrefix

    let sortArray: SortByObject<BookLibraryItem>[] = []
    const direction = payload.sortDesc ? 'desc' : 'asc'
    if (!payload.sortBy || payload.sortBy === 'sequence') {
      sortArray = [
        {
          [direction]: (li: BookLibraryItem) => {
            // cast(d): find is typed as possibly undefined; the items are the books of this series, so the series is found
            const series = li.media.series.find((se) => se.id === seriesId) as SeriesExpanded
            return series.bookSeries.sequence
          }
        },
        {
          // If no series sequence then fallback to sorting by title (or collapsed series name for sub-series)
          [direction]: (li: BookLibraryItem) => {
            if (sortingIgnorePrefix) {
              return li.collapsedSeries?.nameIgnorePrefix || li.media.titleIgnorePrefix
            } else {
              return li.collapsedSeries?.name || li.media.title
            }
          }
        }
      ]
    } else {
      // If series are collapsed and not sorting by title or sequence,
      // sort all collapsed series to the end in alphabetical order
      if (payload.sortBy !== 'media.metadata.title') {
        sortArray.push({
          asc: (li) => {
            if (li.collapsedSeries) {
              return sortingIgnorePrefix ? li.collapsedSeries.nameIgnorePrefix : li.collapsedSeries.name
            } else {
              return ''
            }
          }
        })
      }
      sortArray.push({
        [direction]: (li: BookLibraryItem) => {
          if (payload.sortBy === 'media.metadata.title') {
            if (sortingIgnorePrefix) {
              return li.collapsedSeries?.nameIgnorePrefix || li.media.titleIgnorePrefix
            } else {
              return li.collapsedSeries?.name || li.media.title
            }
          } else {
            if (payload.sortBy === 'media.metadata.authorName') return li.authorNamesFirstLast ?? ''
            if (payload.sortBy === 'media.metadata.authorNameLF') return li.authorNamesLastFirst ?? ''
            // cast(d) (2): this is the else branch of !payload.sortBy, so sortBy is set (narrowing does not reach the callback); each step of the path is an object or undefined
            return (payload.sortBy as string).split('.').reduce<unknown>((a, b) => (a as Record<string, unknown> | undefined)?.[b], li) ?? ''
          }
        }
      })
    }

    libraryItems = naturalSort(libraryItems).by(sortArray)

    if (payload.limit) {
      // cast(d): page is optional; an undefined page gives NaN, as in the JS
      const startIndex = (payload.page as number) * payload.limit
      libraryItems = libraryItems.slice(startIndex, startIndex + payload.limit)
    }

    return Promise.all(
      libraryItems.map(async (li) => {
        // cast(d): find is typed as possibly undefined; the items are the books of this series, so the series is found
        const filteredSeries = li.media.series.find((se) => se.id === seriesId) as SeriesExpanded
        // cast(d): toOldJSONMinified of a book library item; CollapsedItemJson adds the series and collapsedSeries set below
        const json = li.toOldJSONMinified() as CollapsedItemJson
        json.media.metadata.series = {
          id: filteredSeries.id,
          name: filteredSeries.name,
          sequence: filteredSeries.bookSeries.sequence
        }

        if (li.collapsedSeries) {
          json.collapsedSeries = {
            id: li.collapsedSeries.id,
            name: li.collapsedSeries.name,
            nameIgnorePrefix: li.collapsedSeries.nameIgnorePrefix,
            libraryItemIds: li.collapsedSeries.books.map((b) => b.id),
            numBooks: li.collapsedSeries.books.length
          }

          // If collapsing by series and filtering by a series, generate the list of sequences the collapsed
          // series represents in the filtered series
          json.collapsedSeries.seriesSequenceList = naturalSort(li.collapsedSeries.books.filter((b) => b.filterSeriesSequence).map((b) => b.filterSeriesSequence))
            .asc()
            .reduce<SequenceRange[]>((ranges, sequence) => {
              // cast(d): the sequences are filtered by filterSeriesSequence above, so each is a set string
              let currentSequence: string | number = sequence as string
              let lastRange = ranges.at(-1)
              let isNumber = /^(\d+|\d+\.\d*|\d*\.\d+)$/.test(currentSequence)
              if (isNumber) currentSequence = parseFloat(currentSequence)

              // cast(d): lastRange.isNumber is checked in the same condition, and a range with isNumber has a number end
              if (lastRange && isNumber && lastRange.isNumber && (lastRange.end as number) + 1 == currentSequence) {
                lastRange.end = currentSequence
              } else {
                ranges.push({ start: currentSequence, end: currentSequence, isNumber: isNumber })
              }

              return ranges
            }, [])
            .map((r) => (r.start == r.end ? r.start : `${r.start}-${r.end}`))
            .join(', ')
        }

        return json
      })
    )
  }
}

export = libraryHelpers
