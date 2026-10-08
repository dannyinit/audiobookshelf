import sequelizeModule = require('sequelize')
import type { Attributes, BelongsToManyGetAssociationsMixin, CreationOptional, HasManyGetAssociationsMixin, Includeable, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute, WhereOptions } from 'sequelize'
import type Book = require('./Book')
import type Feed = require('./Feed')
import type LibraryItem = require('./LibraryItem')
import type User = require('./User')
import type { ModelsSequelize } from './types'
const { DataTypes, Model, Sequelize } = sequelizeModule

class Collection extends Model<InferAttributes<Collection>, InferCreationAttributes<Collection>> {
  declare id: CreationOptional<string>
  declare name: string
  declare description: string | null
  declare libraryId: string
  declare updatedAt: CreationOptional<Date>
  declare createdAt: CreationOptional<Date>

  declare sequelize: ModelsSequelize
  declare static readonly sequelize: ModelsSequelize

  // Expanded properties

  /** only set when expanded (books with their libraryItem, authors and series) */
  declare books: NonAttribute<Book.BookExpandedWithLibraryItem[]>

  // Associations, only set when included

  declare feeds?: NonAttribute<Feed[]>

  declare getBooks: BelongsToManyGetAssociationsMixin<Book>
  declare getFeeds: HasManyGetAssociationsMixin<Feed>

  /**
   * Get all toOldJSONExpanded, items filtered for user permissions
   */
  static async getOldCollectionsJsonExpanded(user: User, libraryId?: string, include?: string[]) {
    let collectionWhere: WhereOptions<Collection> | null = null
    if (libraryId) {
      collectionWhere = {
        libraryId
      }
    }

    // Optionally include rssfeed for collection
    const collectionIncludes: Includeable[] = []
    if (include?.includes('rssfeed')) {
      collectionIncludes.push({
        model: this.sequelize.models.feed
      })
    }

    const collections = await this.findAll({
      // cast(b): sequelize accepts a null where (no condition), its types do not
      where: collectionWhere as WhereOptions<Collection>,
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
        },
        ...collectionIncludes
      ],
      order: [[this.sequelize.models.book, this.sequelize.models.collectionBook, 'order', 'ASC']]
    })
    // TODO: Handle user permission restrictions on initial query
    return collections
      .map((c) => {
        // Filter books using user permissions
        const books =
          c.books?.filter((b) => {
            if (user) {
              if (b.tags?.length && !user.checkCanAccessLibraryItemWithTags(b.tags)) {
                return false
              }
              if (b.explicit === true && !user.canAccessExplicitContent) {
                return false
              }
            }
            return true
          }) || []

        // Users with restricted permissions will not see this collection
        if (!books.length && c.books.length) {
          return null
        }

        // NOTE: this is the Collection class (static method), not c, so c.toOldJSONExpanded() below uses the unfiltered books
        // cast(c): the JS sets books on the class; see the NOTE above
        (this as typeof Collection & { books?: Book.BookExpandedWithLibraryItem[] }).books = books

        // Typed with rssFeed, which is added below
        const collectionExpanded: ReturnType<Collection['toOldJSONExpanded']> & { rssFeed?: ReturnType<Feed['toOldJSON']> } = c.toOldJSONExpanded()

        // Map feed if found
        if (c.feeds?.length) {
          collectionExpanded.rssFeed = c.feeds[0].toOldJSON()
        }

        return collectionExpanded
      })
      .filter((c) => c)
  }

  static async getExpandedById(collectionId: string): Promise<Collection | null> {
    return this.findByPk(collectionId, {
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
      ],
      order: [[this.sequelize.models.book, this.sequelize.models.collectionBook, 'order', 'ASC']]
    })
  }

  /**
   * Remove all collections belonging to library
   * @returns number of collections destroyed
   */
  static async removeAllForLibrary(libraryId: string): Promise<number> {
    if (!libraryId) return 0
    return this.destroy({
      where: {
        libraryId
      }
    })
  }

  /**
   * Initialize model
   */
  static init(sequelize: ModelsSequelize): void
  // Model.init signature, only declared so the class stays assignable to Model (Database calls init(sequelize))
  static init<MS extends ModelStatic<sequelizeModule.Model>, M extends InstanceType<MS>>(this: MS, attributes: ModelAttributes<M, Attributes<M>> | ModelsSequelize, options?: InitOptions<M>): MS
  static init(sequelize: ModelsSequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        name: DataTypes.STRING,
        description: DataTypes.TEXT
      },
      {
        sequelize,
        modelName: 'collection'
      }
    )

    const { library } = sequelize.models

    library.hasMany(Collection)
    Collection.belongsTo(library)
  }

  /**
   * Get all books in collection expanded with library item
   */
  getBooksExpandedWithLibraryItem(): Promise<Book.BookExpandedWithLibraryItem[]> {
    return this.getBooks({
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
      order: [Sequelize.literal('`collectionBook.order` ASC')]
      // cast(b): the libraryItem is included, which getBooks does not type
    }) as Promise<Book.BookExpandedWithLibraryItem[]>
  }

  /**
   * Get toOldJSONExpanded, items filtered for user permissions
   */
  async getOldJsonExpanded(user: User | null, include?: string[]) {
    this.books = await this.getBooksExpandedWithLibraryItem()

    // Filter books using user permissions
    // TODO: Handle user permission restrictions on initial query
    if (user) {
      const books = this.books.filter((b) => {
        if (b.tags?.length && !user.checkCanAccessLibraryItemWithTags(b.tags)) {
          return false
        }
        if (b.explicit === true && !user.canAccessExplicitContent) {
          return false
        }
        return true
      })

      // Users with restricted permissions will not see this collection
      if (!books.length && this.books.length) {
        return null
      }

      this.books = books
    }

    // Typed with rssFeed, which is added below
    const collectionExpanded: ReturnType<Collection['toOldJSONExpanded']> & { rssFeed?: ReturnType<Feed['toOldJSON']> } = this.toOldJSONExpanded()

    if (include?.includes('rssfeed')) {
      const feeds = await this.getFeeds()
      if (feeds?.length) {
        collectionExpanded.rssFeed = feeds[0].toOldJSON()
      }
    }

    return collectionExpanded
  }

  /**
   * @param [libraryItemIds=[]]
   */
  toOldJSON(libraryItemIds: string[] = []) {
    return {
      id: this.id,
      libraryId: this.libraryId,
      name: this.name,
      description: this.description,
      books: [...libraryItemIds],
      lastUpdate: this.updatedAt.valueOf(),
      createdAt: this.createdAt.valueOf()
    }
  }

  toOldJSONExpanded() {
    if (!this.books) {
      throw new Error('Books are required to expand Collection')
    }

    // Typed with expanded books, which replace the library item ids below
    const json: Omit<ReturnType<Collection['toOldJSON']>, 'books'> & { books: string[] | ReturnType<LibraryItem['toOldJSONExpanded']>[] } = this.toOldJSON()
    json.books = this.books.map((book) => {
      const libraryItem = book.libraryItem
      // Same object as book, typed with the association optional so it can be deleted
      const bookAssociations: { libraryItem?: LibraryItem } = book
      delete bookAssociations.libraryItem
      libraryItem.media = book
      return libraryItem.toOldJSONExpanded()
    })

    return json
  }
}

export = Collection
