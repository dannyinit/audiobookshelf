import Sequelize = require('sequelize')
import type { Attributes, BelongsToManyGetAssociationsMixin, OrderItem, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import utils = require('../utils/index')
import type Book = require('./Book')
import type BookSeries = require('./BookSeries')
import type { ModelsSequelize } from './types'
const { DataTypes, Model, where, fn, col, literal } = Sequelize
const { getTitlePrefixAtEnd, getTitleIgnorePrefix } = utils

class Series extends Model<InferAttributes<Series>, InferCreationAttributes<Series>> {
  declare id: CreationOptional<string>
  declare name: string
  declare nameIgnorePrefix: string
  declare description: CreationOptional<string | null>
  declare libraryId: string
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize

  // Expanded properties

  /** only set when expanded (books with their libraryItem, authors and series) */
  declare books: NonAttribute<Book.BookExpandedWithLibraryItem[]>
  /** Join table row, set when loaded through Book.series */
  declare bookSeries: NonAttribute<BookSeries>

  declare getBooks: BelongsToManyGetAssociationsMixin<Book>

  /**
   * Check if series exists
   */
  static async checkExistsById(seriesId: string): Promise<boolean> {
    return (await this.count({ where: { id: seriesId } })) > 0
  }

  /**
   * Get series by name and libraryId. name case insensitive
   */
  static async getByNameAndLibrary(seriesName: string, libraryId: string): Promise<Series | null> {
    return this.findOne({
      where: [
        where(fn('lower', col('name')), seriesName.toLowerCase()),
        {
          libraryId
        }
      ]
    })
  }

  static async getExpandedById(seriesId: string): Promise<Series | null> {
    const series = await this.findByPk(seriesId)
    if (!series) return null
    series.books = await series.getBooksExpandedWithLibraryItem()
    return series
  }

  static async findOrCreateByNameAndLibrary(seriesName: string, libraryId: string): Promise<Series> {
    const series = await this.getByNameAndLibrary(seriesName, libraryId)
    if (series) return series
    return this.create({
      name: seriesName,
      nameIgnorePrefix: getTitleIgnorePrefix(seriesName),
      libraryId
    })
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
        },
        name: DataTypes.STRING,
        nameIgnorePrefix: DataTypes.STRING,
        description: DataTypes.TEXT
      },
      {
        sequelize,
        modelName: 'series',
        indexes: [
          {
            fields: [
              {
                name: 'name',
                collate: 'NOCASE'
              }
            ]
          },
          // {
          //   fields: [{
          //     name: 'nameIgnorePrefix',
          //     collate: 'NOCASE'
          //   }]
          // },
          {
            // unique constraint on name and libraryId
            fields: ['name', 'libraryId'],
            unique: true,
            name: 'unique_series_name_per_library'
          },
          {
            fields: ['libraryId']
          }
        ]
      }
    )

    const { library } = sequelize.models
    library.hasMany(Series, {
      onDelete: 'CASCADE'
    })
    Series.belongsTo(library)
  }

  /**
   * Get all books in collection expanded with library item
   */
  getBooksExpandedWithLibraryItem(): Promise<Book.BookExpandedWithLibraryItem[]> {
    return this.getBooks({
      joinTableAttributes: ['sequence'],
      include: [
        {
          model: this.sequelize.models.libraryItem
        },
        {
          model: this.sequelize.models.author,
          through: {
            attributes: []
          }
        },
        {
          model: this.sequelize.models.series,
          through: {
            attributes: ['sequence']
          }
        }
      ],
      // cast(b): sequelize accepts an order item with only a literal (which holds the direction), its types do not
      order: [[literal('CAST(`bookSeries.sequence` AS FLOAT) ASC NULLS LAST')] as unknown as OrderItem]
      // cast(b): the libraryItem is included, which getBooks does not type
    }) as Promise<Book.BookExpandedWithLibraryItem[]>
  }

  toOldJSON() {
    return {
      id: this.id,
      name: this.name,
      nameIgnorePrefix: getTitlePrefixAtEnd(this.name),
      description: this.description,
      addedAt: this.createdAt.valueOf(),
      updatedAt: this.updatedAt.valueOf(),
      libraryId: this.libraryId
    }
  }

  toJSONMinimal(sequence: string | null) {
    return {
      id: this.id,
      name: this.name,
      sequence
    }
  }
}

export = Series
