import { DataTypes, Model, ModelCtor, Sequelize } from 'sequelize'
import { Literal } from 'sequelize/types/utils'

class Collection extends Model {
  declare feeds: string | any[]
  static books: any[]
  /** @type {string} */
  declare id: string
  /** @type {string} */
  declare name: string
  /** @type {string} */
  declare description: string
  /** @type {string} */
  declare libraryId: string
  /** @type {Date} */
  declare updatedAt: Date
  /** @type {Date} */
  declare createdAt: Date
  /** @type {import('./Book').BookExpandedWithLibraryItem[]} - only set when expanded */
  declare books: import('./Book').BookExpandedWithLibraryItem[]

  /**
   * Get all toOldJSONExpanded, items filtered for user permissions
   *
   * @param {import('./User')} user
   * @param {string} [libraryId]
   * @param {string[]} [include]
   * @async
   */
  static async getOldCollectionsJsonExpanded(user: import('./User'), libraryId: string, include: string[]) {
    let collectionWhere = null
    if (libraryId) {
      collectionWhere = {
        libraryId
      }
    }

    // Optionally include rssfeed for collection
    const collectionIncludes = []
    if (include?.includes('rssfeed')) {
      collectionIncludes.push({
        model: this.sequelize!.models.feed
      })
    }

    const collections = await this.findAll({
      where: collectionWhere,
      include: [
        {
          model: this.sequelize!.models.book,
          include: [
            {
              model: this.sequelize!.models.libraryItem
            },
            {
              model: this.sequelize!.models.author,
              through: {
                attributes: []
              }
            },
            {
              model: this.sequelize!.models.series,
              through: {
                attributes: ['sequence']
              }
            }
          ]
        },
        ...collectionIncludes
      ],
      order: [[this.sequelize!.models.book, this.sequelize!.models.collectionBook, 'order', 'ASC']]
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

        this.books = books

        const collectionExpanded = c.toOldJSONExpanded()

        // Map feed if found
        if (c.feeds?.length) {
          collectionExpanded.rssFeed = c.feeds[0].toOldJSON()
        }

        return collectionExpanded
      })
      .filter((c) => c)
  }

  /**
   *
   * @param {string} collectionId
   * @returns {Promise<Collection>}
   */
  static async getExpandedById(collectionId: string): Promise<Collection> {
    return this.findByPk(collectionId, {
      include: [
        {
          model: this.sequelize!.models.book,
          include: [
            {
              model: this.sequelize!.models.libraryItem
            },
            {
              model: this.sequelize!.models.author,
              through: {
                attributes: []
              }
            },
            {
              model: this.sequelize!.models.series,
              through: {
                attributes: ['sequence']
              }
            }
          ]
        }
      ],
      order: [[this.sequelize!.models.book, this.sequelize!.models.collectionBook, 'order', 'ASC']]
    })
  }

  /**
   * Remove all collections belonging to library
   * @param {string} libraryId
   * @returns {Promise<number>} number of collections destroyed
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
   * @param sequelize
   */
  static initModel(sequelize: Sequelize) {
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
   *
   * @returns {Promise<import('./Book').BookExpandedWithLibraryItem[]>}
   */
  getBooksExpandedWithLibraryItem(): Promise<import('./Book').BookExpandedWithLibraryItem[]> {
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
    })
  }

  /**
   * Get toOldJSONExpanded, items filtered for user permissions
   *
   * @param {import('./User')|null} user
   * @param {string[]} [include]
   * @async
   */
  async getOldJsonExpanded(user: import('./User') | null, include: string[]) {
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

    const collectionExpanded = this.toOldJSONExpanded()

    if (include?.includes('rssfeed')) {
      const feeds = await this.getFeeds()
      if (feeds?.length) {
        collectionExpanded.rssFeed = feeds[0].toOldJSON()
      }
    }

    return collectionExpanded
  }

  /**
   *
   * @param {string[]} [libraryItemIds=[]]
   * @returns
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

    const json = this.toOldJSON()
    json.books = this.books.map((book) => {
      const libraryItem = book.libraryItem
      delete book.libraryItem
      libraryItem.media = book
      return libraryItem.toOldJSONExpanded()
    })

    return json
  }
}

export = Collection
