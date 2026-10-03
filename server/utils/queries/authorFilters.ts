import Sequelize = require('sequelize')
import DatabaseModule = require('../../Database')
import BookAuthor = require('../../models/BookAuthor')
import Author = require('../../models/Author')
import type { TextSearchQuery, TypedDatabase } from '../types'

// Same object; typed so the model static query methods can be called
const Database = DatabaseModule as TypedDatabase

export = {
  /**
   * Get authors total count
   *
   * @returns count
   */
  async getAuthorsTotalCount(libraryId: string): Promise<number> {
    const authorsCount = await Database.authorModel.count({
      where: {
        libraryId: libraryId
      }
    })
    return authorsCount
  },

  /**
   * Get authors with count of num books
   *
   */
  async getAuthorsWithCount(libraryId: string, limit: number) {
    const authors = await Database.bookAuthorModel.findAll({
      include: [
        {
          model: Database.authorModel,
          as: 'author', // Use the correct alias as defined in your associations
          attributes: ['name'],
          where: {
            libraryId: libraryId
          }
        }
      ],
      attributes: ['authorId', [Sequelize.fn('COUNT', Sequelize.col('authorId')), 'count']],
      group: ['authorId', 'author.id'], // Include 'author.id' to satisfy GROUP BY with JOIN
      order: [[Sequelize.literal('count'), 'DESC']],
      limit: limit
    })
    // author is included above
    return (authors as (BookAuthor & { author: Author })[]).map((au) => {
      return {
        id: au.authorId,
        name: au.author.name,
        count: au.get('count') // Use get method to access aliased attributes
      }
    })
  },

  /**
   * Search authors
   *
   * @returns oldAuthor with numBooks
   */
  async search(libraryId: string, query: TextSearchQuery, limit: number, offset: number) {
    const matchAuthor = query.matchExpression('name')
    const authors = await Database.authorModel.findAll({
      where: {
        [Sequelize.Op.and]: [Sequelize.literal(matchAuthor), { libraryId }]
      },
      attributes: {
        include: [[Sequelize.literal('(SELECT count(*) FROM bookAuthors ba WHERE ba.authorId = author.id)'), 'numBooks']]
      },
      limit,
      offset
    })
    const authorMatches = []
    for (const author of authors) {
      const oldAuthor = author.toOldJSONExpanded(author.dataValues.numBooks)
      authorMatches.push(oldAuthor)
    }
    return authorMatches
  }
}
