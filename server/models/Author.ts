import { DataTypes, Model, where, fn, col } from 'sequelize'
import parseNameString = require('../utils/parsers/parseNameString')

class Author extends Model {
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare name: string
  /** @type {string} */
  declare lastFirst: string
  /** @type {string} */
  declare asin: string
  /** @type {string} */
  declare description: string
  /** @type {string} */
  declare imagePath: string
  /** @type {string} */
  declare libraryId: string
  /** @type {Date} */
  declare updatedAt: Date
  /** @type {Date} */
  declare createdAt: Date

  constructor(values, options) {
    super(values, options)

  }

  /**
   *
   * @param {string} name
   * @returns {string}
   */
  static getLastFirst(name: string): string {
    if (!name) return null
    return parseNameString.nameToLastFirst(name)
  }

  /**
   * Check if author exists
   * @param {string} authorId
   * @returns {Promise<boolean>}
   */
  static async checkExistsById(authorId: string): Promise<boolean> {
    return (await this.count({ where: { id: authorId } })) > 0
  }

  /**
   * Get author by name and libraryId. name case insensitive
   * TODO: Look for authors ignoring punctuation
   *
   * @param {string} authorName
   * @param {string} libraryId
   * @returns {Promise<Author>}
   */
  static async getByNameAndLibrary(authorName: string, libraryId: string): Promise<Author> {
    return this.findOne({
      where: [
        where(fn('lower', col('name')), authorName.toLowerCase()),
        {
          libraryId
        }
      ]
    })
  }

  /**
   *
   * @param {string} authorId
   * @returns {Promise<import('./LibraryItem')[]>}
   */
  static async getAllLibraryItemsForAuthor(authorId: string): Promise<import('./LibraryItem')[]> {
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

    const libraryItems = []
    if (author.books) {
      for (const book of author.books) {
        const libraryItem = book.libraryItem
        libraryItem.media = book
        delete book.libraryItem
        libraryItems.push(libraryItem)
      }
    }

    return libraryItems
  }

  /**
   *
   * @param {string} name
   * @param {string} libraryId
   * @returns {Promise<{ author: Author, created: boolean }>}
   */
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

  /**
   *
   * @param {number} numBooks
   * @returns
   */
  toOldJSONExpanded(numBooks: number = 0) {
    const oldJson = this.toOldJSON()
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
