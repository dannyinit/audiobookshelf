import { DataTypes, Model } from 'sequelize'

class BookSeries extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare sequence: string
  /** @type {string} */
  declare bookId: string
  /** @type {string} */
  declare seriesId: string
  /** @type {Date} */
  declare createdAt: Date

  constructor(values, options) {
    super(values, options)

  }

  static removeByIds(seriesId = null, bookId = null) {
    const where = {}
    if (seriesId) where.seriesId = seriesId
    if (bookId) where.bookId = bookId
    return this.destroy({
      where
    })
  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize: import('../Database').sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        sequence: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'bookSeries',
        timestamps: true,
        updatedAt: false,
        indexes: [
          {
            name: 'bookSeries_seriesId',
            fields: ['seriesId']
          },
          {
            name: 'book_series_series_book',
            fields: ['seriesId', 'bookId']
          }
        ]
      }
    )

    // Super Many-to-Many
    // ref: https://sequelize.org/docs/v6/advanced-association-concepts/advanced-many-to-many/#the-best-of-both-worlds-the-super-many-to-many-relationship
    const { book, series } = sequelize.models
    book.belongsToMany(series, { through: BookSeries })
    series.belongsToMany(book, { through: BookSeries })

    book.hasMany(BookSeries, {
      onDelete: 'CASCADE'
    })
    BookSeries.belongsTo(book)

    series.hasMany(BookSeries, {
      onDelete: 'CASCADE'
    })
    BookSeries.belongsTo(series)
  }
}

export = BookSeries
