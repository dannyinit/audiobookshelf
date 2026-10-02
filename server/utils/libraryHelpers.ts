import { createNewSortInstance } from '../libs/fastSort'
import Database = require('../Database')
import Logger = require('../Logger')
import { getTitlePrefixAtEnd, isNullOrNaN, getTitleIgnorePrefix } from '../utils/index'
const naturalSort = createNewSortInstance({
  comparer: new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare
})

type LibraryItem = import('../models/LibraryItem')
type BookExpanded = import('../models/Book').BookExpanded
/** Old library item json (toOldJSONMinified) with extra properties attached */
type OldLibraryItemJson = Record<string, any>

interface SeriesWithBooks {
  id: string
  name: string
  nameIgnorePrefix: string
  nameIgnorePrefixSort: string
  type: 'series'
  books: OldLibraryItemJson[]
  totalDuration: number
}

/** Library item with the series it was collapsed into (see collapseBookSeries) */
type CollapsedLibraryItem = LibraryItem

const VALID_COLLAPSE_SUBSERIES_SORTS = new Set(['addedAt', 'size', 'birthtimeMs', 'mtimeMs', 'media.duration', 'media.metadata.publishedYear', 'media.metadata.authorName', 'media.metadata.authorNameLF', 'media.metadata.title', 'sequence', 'progress', 'progress.createdAt', 'progress.finishedAt', 'random'])

export = {
  /**
   *
   * @param {import('../models/LibraryItem')[]} libraryItems
   * @param {*} filterSeries
   * @param {*} hideSingleBookSeries
   * @returns
   */
  getSeriesFromBooks(libraryItems: LibraryItem[], filterSeries: string | null | undefined, hideSingleBookSeries: boolean): SeriesWithBooks[] {
    const _series: Record<string, SeriesWithBooks> = {}
    const seriesToFilterOut: Record<string, boolean> = {}
    libraryItems.forEach((libraryItem) => {
      const book = libraryItem.media as BookExpanded
      // get all book series for item that is not already filtered out
      const allBookSeries = (book.series || []).filter((se) => !seriesToFilterOut[se.id])
      if (!allBookSeries.length) return

      allBookSeries.forEach((bookSeries) => {
        const abJson: OldLibraryItemJson = libraryItem.toOldJSONMinified()
        abJson.sequence = bookSeries.bookSeries.sequence
        if (filterSeries) {
          const series = book.series.find((se) => se.id === filterSeries)!
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
   *
   * @param {import('../models/LibraryItem')[]} libraryItems
   * @param {string} filterSeries - series id
   * @param {boolean} hideSingleBookSeries
   * @returns
   */
  collapseBookSeries(libraryItems: LibraryItem[], filterSeries: string | null | undefined, hideSingleBookSeries: boolean): CollapsedLibraryItem[] {
    // Get series from the library items. If this list is being collapsed after filtering for a series,
    // don't collapse that series, only books that are in other series.
    const seriesObjects = this.getSeriesFromBooks(libraryItems, filterSeries, hideSingleBookSeries).filter((s) => s.id != filterSeries)

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

  /**
   *
   * @param {*} payload
   * @param {string} seriesId
   * @param {import('../models/User')} user
   * @param {import('../models/Library')} library
   * @returns {Object[]}
   */
  async handleCollapseSubseries(payload: any, seriesId: string, user: import('../models/User'), library: import('../models/Library')): Promise<Record<string, any>[]> {
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

    const books = seriesWithBooks.books
    payload.total = books.length

    let libraryItems: CollapsedLibraryItem[] = books
      .map((book) => {
        const libraryItem = book.libraryItem
        delete (book as { libraryItem?: unknown }).libraryItem
        libraryItem.media = book
        return libraryItem
      })
      .filter((li) => {
        return user.checkCanAccessLibraryItem(li)
      })

    const collapsedItems = this.collapseBookSeries(libraryItems, seriesId, library.settings.hideSingleBookSeries)
    if (!(collapsedItems.length == 1 && collapsedItems[0].collapsedSeries)) {
      libraryItems = collapsedItems
      payload.total = libraryItems.length
    }

    const sortingIgnorePrefix = Database.serverSettings.sortingIgnorePrefix

    let sortArray: Record<string, (li: CollapsedLibraryItem) => any>[] = []
    const direction = payload.sortDesc ? 'desc' : 'asc'
    if (!payload.sortBy || payload.sortBy === 'sequence') {
      sortArray = [
        {
          [direction]: (li: CollapsedLibraryItem) => {
            const series = (li.media as BookExpanded).series.find((se) => se.id === seriesId)!
            return series.bookSeries.sequence
          }
        },
        {
          // If no series sequence then fallback to sorting by title (or collapsed series name for sub-series)
          [direction]: (li: CollapsedLibraryItem) => {
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
          asc: (li: CollapsedLibraryItem) => {
            if (li.collapsedSeries) {
              return sortingIgnorePrefix ? li.collapsedSeries.nameIgnorePrefix : li.collapsedSeries.name
            } else {
              return ''
            }
          }
        })
      }
      sortArray.push({
        [direction]: (li: CollapsedLibraryItem) => {
          if (payload.sortBy === 'media.metadata.title') {
            if (sortingIgnorePrefix) {
              return li.collapsedSeries?.nameIgnorePrefix || li.media.titleIgnorePrefix
            } else {
              return li.collapsedSeries?.name || li.media.title
            }
          } else {
            if (payload.sortBy === 'media.metadata.authorName') return li.authorNamesFirstLast ?? ''
            if (payload.sortBy === 'media.metadata.authorNameLF') return li.authorNamesLastFirst ?? ''
            return payload.sortBy.split('.').reduce((a: any, b: string) => a?.[b], li) ?? ''
          }
        }
      })
    }

    libraryItems = naturalSort(libraryItems).by(sortArray)

    if (payload.limit) {
      const startIndex = payload.page * payload.limit
      libraryItems = libraryItems.slice(startIndex, startIndex + payload.limit)
    }

    return Promise.all(
      libraryItems.map(async (li) => {
        const filteredSeries = (li.media as BookExpanded).series.find((se) => se.id === seriesId)!
        const json: OldLibraryItemJson = li.toOldJSONMinified()
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
            libraryItemIds: li.collapsedSeries.books.map((b: OldLibraryItemJson) => b.id),
            numBooks: li.collapsedSeries.books.length
          }

          // If collapsing by series and filtering by a series, generate the list of sequences the collapsed
          // series represents in the filtered series
          json.collapsedSeries.seriesSequenceList = naturalSort(li.collapsedSeries.books.filter((b: OldLibraryItemJson) => b.filterSeriesSequence).map((b: OldLibraryItemJson) => b.filterSeriesSequence))
            .asc()
            .reduce((ranges: { start: any; end: any; isNumber: boolean }[], currentSequence: any) => {
              let lastRange = ranges.at(-1)
              let isNumber = /^(\d+|\d+\.\d*|\d*\.\d+)$/.test(currentSequence)
              if (isNumber) currentSequence = parseFloat(currentSequence)

              if (lastRange && isNumber && lastRange.isNumber && lastRange.end + 1 == currentSequence) {
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
