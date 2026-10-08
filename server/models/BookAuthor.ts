import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import type Author = require('./Author')
import type Book = require('./Book')
import type { ModelsSequelize } from './types'
const { DataTypes, Model, fn, col } = Sequelize

class BookAuthor extends Model<InferAttributes<BookAuthor>, InferCreationAttributes<BookAuthor>> {
  declare id: CreationOptional<string>
  declare bookId: string
  declare authorId: string
  declare createdAt: CreationOptional<Date>

  // Associations, only set when included

  declare book?: NonAttribute<Book>
  declare author?: NonAttribute<Author>

  static removeByIds(authorId: string | null = null, bookId: string | null = null) {
    const where: { authorId?: string; bookId?: string } = {}
    if (authorId) where.authorId = authorId
    if (bookId) where.bookId = bookId
    return this.destroy({
      where
    })
  }

  /**
   * Get number of books for author
   */
  static getCountForAuthor(authorId: string): Promise<number> {
    return this.count({
      where: {
        authorId
      }
    })
  }

  /**
   * Get number of books for each author
   */
  static async getCountsForAuthors(authorIds: string[]): Promise<Record<string, number>> {
    if (!authorIds.length) return {}

    const rows = await this.findAll({
      attributes: ['authorId', [fn('COUNT', col('id')), 'count']],
      where: {
        authorId: authorIds
      },
      group: ['authorId'],
      raw: true
    })

    const counts: Record<string, number> = {}
    // cast(b): raw rows are plain objects with the selected attributes; findAll types them as model instances without the count alias
    for (const row of rows as unknown as { authorId: string; count: number | string }[]) {
      counts[row.authorId] = Number(row.count)
    }
    return counts
  }

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
        }
      },
      {
        sequelize,
        modelName: 'bookAuthor',
        timestamps: true,
        updatedAt: false,
        indexes: [
          {
            name: 'bookAuthor_authorId',
            fields: ['authorId']
          }
        ]
      }
    )

    // Super Many-to-Many
    // ref: https://sequelize.org/docs/v6/advanced-association-concepts/advanced-many-to-many/#the-best-of-both-worlds-the-super-many-to-many-relationship
    const { book, author } = sequelize.models
    book.belongsToMany(author, { through: BookAuthor })
    author.belongsToMany(book, { through: BookAuthor })

    book.hasMany(BookAuthor, {
      onDelete: 'CASCADE'
    })
    BookAuthor.belongsTo(book)

    author.hasMany(BookAuthor, {
      onDelete: 'CASCADE'
    })
    BookAuthor.belongsTo(author)
  }
}
export = BookAuthor
