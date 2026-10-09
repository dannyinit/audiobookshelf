import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import parseNameString = require('../utils/parsers/parseNameString')
import type Book = require('./Book')
import type BookAuthor = require('./BookAuthor')
import type LibraryItem = require('./LibraryItem')
import type { ModelsSequelize } from './types'
const { DataTypes, Model, where, fn, col } = Sequelize

class Author extends Model<InferAttributes<Author>, InferCreationAttributes<Author>> {
  declare id: CreationOptional<string>
  declare name: string
  declare lastFirst: string | null
  declare asin: string | null
  declare description: string | null
  declare imagePath: string | null
  declare libraryId: string
  declare updatedAt: CreationOptional<Date>
  declare createdAt: CreationOptional<Date>

  declare static readonly sequelize: ModelsSequelize

  // Associations, only set when included

  /** Loaded with their libraryItem (see getAllLibraryItemsForAuthor) */
  declare books?: NonAttribute<Book.BookExpandedWithLibraryItem[]>

  /** The book_author join row, when the author is loaded through a book (like Series bookSeries) */
  declare bookAuthor: NonAttribute<BookAuthor>

  static getLastFirst(name: string): string | null | undefined {
    if (!name) return null
    return parseNameString.nameToLastFirst(name)
  }

  /**
   * Check if author exists
   */
  static async checkExistsById(authorId: string): Promise<boolean> {
    return (await this.count({ where: { id: authorId } })) > 0
  }

  /**
   * Get author by name and libraryId. name case insensitive
   * TODO: Look for authors ignoring punctuation
   */
  static async getByNameAndLibrary(authorName: string, libraryId: string): Promise<Author | null> {
    return this.findOne({
      where: [
        where(fn('lower', col('name')), authorName.toLowerCase()),
        {
          libraryId
        }
      ]
    })
  }

  static async getAllLibraryItemsForAuthor(authorId: string): Promise<LibraryItem[]> {
    const author = await this.findByPk(authorId, {
      include: [
        {
          model: this.sequelize.models.book,
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
          ]
        }
      ]
    })

    const libraryItems: LibraryItem[] = []
    // NOTE: author is null when no author has this id, then reading books throws a TypeError
    if (author!.books) {
      for (const book of author!.books) {
        const libraryItem = book.libraryItem
        libraryItem.media = book
        // Same object as book, typed with the association optional so it can be deleted
        const bookAssociations: { libraryItem?: LibraryItem } = book
        delete bookAssociations.libraryItem
        libraryItems.push(libraryItem)
      }
    }

    return libraryItems
  }

  static async findOrCreateByNameAndLibrary(name: string, libraryId: string): Promise<{ author: Author; created: boolean }> {
    const author = await this.getByNameAndLibrary(name, libraryId)
    if (author) return { author, created: false }
    const newAuthor = await this.create({
      name,
      lastFirst: this.getLastFirst(name),
      libraryId
    })
    return { author: newAuthor, created: true }
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
        lastFirst: DataTypes.STRING,
        asin: DataTypes.STRING,
        description: DataTypes.TEXT,
        imagePath: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'author',
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
          //     name: 'lastFirst',
          //     collate: 'NOCASE'
          //   }]
          // },
          {
            fields: ['libraryId']
          }
        ]
      }
    )

    const { library } = sequelize.models
    library.hasMany(Author, {
      onDelete: 'CASCADE'
    })
    Author.belongsTo(library)
  }

  toOldJSON() {
    return {
      id: this.id,
      asin: this.asin,
      name: this.name,
      description: this.description,
      imagePath: this.imagePath,
      libraryId: this.libraryId,
      addedAt: this.createdAt.valueOf(),
      updatedAt: this.updatedAt.valueOf()
    }
  }

  toOldJSONExpanded(numBooks = 0) {
    // Typed with numBooks, which is added below
    const oldJson: ReturnType<Author['toOldJSON']> & { numBooks?: number } = this.toOldJSON()
    oldJson.numBooks = numBooks
    return oldJson
  }

  toJSONMinimal() {
    return {
      id: this.id,
      name: this.name
    }
  }
}
export = Author
