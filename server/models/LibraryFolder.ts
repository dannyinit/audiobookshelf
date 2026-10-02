import { DataTypes, Model } from 'sequelize'

class LibraryFolder extends Model {
  /** @type {string} */
  declare id
  /** @type {string} */
  declare path
  /** @type {string} */
  declare libraryId
  /** @type {Date} */
  declare createdAt
  /** @type {Date} */
  declare updatedAt

  constructor(values, options) {
    super(values, options)

  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        path: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'libraryFolder'
      }
    )

    const { library } = sequelize.models
    library.hasMany(LibraryFolder, {
      onDelete: 'CASCADE'
    })
    LibraryFolder.belongsTo(library)
  }

  /**
   * TODO: Update to use new model
   */
  toOldJSON() {
    return {
      id: this.id,
      fullPath: this.path,
      libraryId: this.libraryId,
      addedAt: this.createdAt.valueOf()
    }
  }
}

export = LibraryFolder
