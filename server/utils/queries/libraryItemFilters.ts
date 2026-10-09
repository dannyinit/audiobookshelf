import Sequelize = require('sequelize')
import Database = require('../../Database')
import libraryItemsBookFilters = require('./libraryItemsBookFilters')
import libraryItemsPodcastFilters = require('./libraryItemsPodcastFilters')
import User = require('../../models/User')
import Library = require('../../models/Library')
import Book = require('../../models/Book')
import Podcast = require('../../models/Podcast')

import type { FilteredLibraryItem } from './types'

/**
 * Book or podcast loaded with its libraryItem
 */
type MediaWithLibraryItem = (Book | Podcast) & { libraryItem: FilteredLibraryItem }

export = {
  /**
   * Get all library items that have tags
   */
  async getAllLibraryItemsWithTags(tags: string[]): Promise<FilteredLibraryItem[]> {
    const libraryItems: FilteredLibraryItem[] = []
    const booksWithTag = await Database.bookModel.findAll({
      where: Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(tags) WHERE json_valid(tags) AND json_each.value IN (:tags))`), {
        [Sequelize.Op.gte]: 1
      }),
      replacements: {
        tags
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
      ],
      order: [
        [Database.authorModel, Database.bookAuthorModel, 'createdAt', 'ASC'],
        [Database.seriesModel, 'bookSeries', 'createdAt', 'ASC']
      ]
    })
    // libraryItem is included above
    for (const book of booksWithTag as MediaWithLibraryItem[]) {
      const libraryItem = book.libraryItem
      libraryItem.media = book
      libraryItems.push(libraryItem)
    }
    const podcastsWithTag = await Database.podcastModel.findAll({
      where: Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(tags) WHERE json_valid(tags) AND json_each.value IN (:tags))`), {
        [Sequelize.Op.gte]: 1
      }),
      replacements: {
        tags
      },
      include: [
        {
          model: Database.libraryItemModel
        },
        {
          model: Database.podcastEpisodeModel
        }
      ]
    })
    // libraryItem is included above
    for (const podcast of podcastsWithTag as MediaWithLibraryItem[]) {
      const libraryItem = podcast.libraryItem
      libraryItem.media = podcast
      libraryItems.push(libraryItem)
    }
    return libraryItems
  },

  /**
   * Get all library items that have genres
   */
  async getAllLibraryItemsWithGenres(genres: string[]): Promise<FilteredLibraryItem[]> {
    const libraryItems: FilteredLibraryItem[] = []
    const booksWithGenre = await Database.bookModel.findAll({
      where: Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(genres) WHERE json_valid(genres) AND json_each.value IN (:genres))`), {
        [Sequelize.Op.gte]: 1
      }),
      replacements: {
        genres
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
    })
    // libraryItem is included above
    for (const book of booksWithGenre as MediaWithLibraryItem[]) {
      const libraryItem = book.libraryItem
      libraryItem.media = book
      libraryItems.push(libraryItem)
    }
    const podcastsWithGenre = await Database.podcastModel.findAll({
      where: Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(genres) WHERE json_valid(genres) AND json_each.value IN (:genres))`), {
        [Sequelize.Op.gte]: 1
      }),
      replacements: {
        genres
      },
      include: [
        {
          model: Database.libraryItemModel
        },
        {
          model: Database.podcastEpisodeModel
        }
      ]
    })
    // libraryItem is included above
    for (const podcast of podcastsWithGenre as MediaWithLibraryItem[]) {
      const libraryItem = podcast.libraryItem
      libraryItem.media = podcast
      libraryItems.push(libraryItem)
    }
    return libraryItems
  },

  /**
   * Get all library items that have narrators
   */
  async getAllLibraryItemsWithNarrators(narrators: string[], libraryId: string): Promise<FilteredLibraryItem[]> {
    const libraryItems: FilteredLibraryItem[] = []
    const booksWithGenre = await Database.bookModel.findAll({
      where: Sequelize.where(Sequelize.literal(`(SELECT count(*) FROM json_each(narrators) WHERE json_valid(narrators) AND json_each.value IN (:narrators))`), {
        [Sequelize.Op.gte]: 1
      }),
      replacements: {
        narrators
      },
      include: [
        {
          model: Database.libraryItemModel,
          where: { libraryId }
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
    for (const book of booksWithGenre as MediaWithLibraryItem[]) {
      const libraryItem = book.libraryItem
      libraryItem.media = book
      libraryItems.push(libraryItem)
    }
    return libraryItems
  },

  /**
   * Search library items
   */
  search(user: User, library: Library, query: string, limit: number) {
    if (library.isBook) {
      return libraryItemsBookFilters.search(user, library, query, limit, 0)
    } else {
      return libraryItemsPodcastFilters.search(user, library, query, limit, 0)
    }
  },

  /**
   * Get largest items in library
   */
  async getLargestItems(libraryId: string, limit: number) {
    const libraryItems = await Database.libraryItemModel.findAll({
      attributes: ['id', 'mediaId', 'mediaType', 'size'],
      where: {
        libraryId
      },
      include: [
        {
          model: Database.bookModel,
          attributes: ['id', 'title']
        },
        {
          model: Database.podcastModel,
          attributes: ['id', 'title']
        }
      ],
      order: [['size', 'DESC']],
      limit
    })
    return libraryItems.map((libraryItem) => {
      return {
        id: libraryItem.id,
        title: libraryItem.media.title,
        size: libraryItem.size
      }
    })
  }
}
