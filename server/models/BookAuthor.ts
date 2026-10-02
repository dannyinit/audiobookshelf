import { DataTypes, Model, fn, col, Sequelize } from 'sequelize'

class BookAuthor extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare bookId: string
  /** @type {string} */
  declare authorId: string
  /** @type {Date} */
  declare createdAt: Date

  static removeByIds(authorId = null, bookId = null) {
    const where = {}
    if (authorId) where.authorId = authorId
    if (bookId) where.bookId = bookId
    return this.destroy({
      where
    })
  }

  /**
   * Get number of books for author
   *
   * @param {string} authorId
   * @returns {Promise<number>}
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
   *
   * @param {string[]} authorIds
   * @returns {Promise<Record<string, number>>}
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

    /** @type {Record<string, number>} */
    const counts: Record<string, number> = {}
    for (const row of rows) {
      counts[row.authorId] = Number(row.count)
    }
    return counts
  }

  /**
   * Initialize model
   * @param sequelize
   */
  static initModel(sequelize: Sequelize) {
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
