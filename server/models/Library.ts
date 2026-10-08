import Sequelize = require('sequelize')
import type { Attributes, CreationOptional, InferAttributes, InferCreationAttributes, InitOptions, ModelAttributes, ModelStatic, NonAttribute } from 'sequelize'
import Logger = require('../Logger')
import type LibraryFolder = require('./LibraryFolder')
import type { LibraryExtraData, LibrarySettingsObject, ModelsSequelize } from './types'
import type * as ModelTypes from './types'
const { DataTypes, Model } = Sequelize

class Library extends Model<InferAttributes<Library>, InferCreationAttributes<Library>> {
  declare id: CreationOptional<string>
  declare name: string
  declare displayOrder: number
  declare icon: string
  declare mediaType: string
  declare provider: string
  declare lastScan: Date | null
  declare lastScanVersion: string | null
  declare settings: LibrarySettingsObject
  declare extraData: LibraryExtraData | null
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  declare static readonly sequelize: ModelsSequelize

  // Associations, only set when included

  declare libraryFolders?: NonAttribute<LibraryFolder[]>

  static getDefaultLibrarySettingsForMediaType(mediaType: string): LibrarySettingsObject {
    if (mediaType === 'podcast') {
      return {
        coverAspectRatio: 1, // Square
        disableWatcher: false,
        autoScanCronExpression: null,
        podcastSearchRegion: 'us',
        markAsFinishedPercentComplete: null,
        markAsFinishedTimeRemaining: 10
      }
    } else {
      return {
        coverAspectRatio: 1, // Square
        disableWatcher: false,
        autoScanCronExpression: null,
        skipMatchingMediaWithAsin: false,
        skipMatchingMediaWithIsbn: false,
        audiobooksOnly: false,
        epubsAllowScriptedContent: false,
        hideSingleBookSeries: false,
        onlyShowLaterBooksInContinueSeries: false,
        metadataPrecedence: this.defaultMetadataPrecedence,
        markAsFinishedPercentComplete: null,
        markAsFinishedTimeRemaining: 10
      }
    }
  }

  static get defaultMetadataPrecedence() {
    return ['folderStructure', 'audioMetatags', 'nfoFile', 'txtFiles', 'opfFile', 'absMetadata']
  }

  static getAllWithFolders(): Promise<Library[]> {
    return this.findAll({
      include: this.sequelize.models.libraryFolder,
      order: [['displayOrder', 'ASC']]
    })
  }

  static findByIdWithFolders(libraryId: string): Promise<Library | null> {
    return this.findByPk(libraryId, {
      include: this.sequelize.models.libraryFolder
    })
  }

  /**
   * Get all library ids
   * @returns array of library ids
   */
  static async getAllLibraryIds(): Promise<string[]> {
    const libraries = await this.findAll({
      attributes: ['id', 'displayOrder'],
      order: [['displayOrder', 'ASC']]
    })
    return libraries.map((l) => l.id)
  }

  /**
   * Get the largest value in the displayOrder column
   * Used for setting a new libraries display order
   */
  static getMaxDisplayOrder() {
    // NOTE: `|| 0` applies to the promise (always truthy), not to the result, so an empty table resolves to null instead of 0
    return this.max('displayOrder') || 0
  }

  /**
   * Updates displayOrder to be sequential
   * Used after removing a library
   */
  static async resetDisplayOrder() {
    const libraries = await this.findAll({
      order: [['displayOrder', 'ASC']]
    })
    for (let i = 0; i < libraries.length; i++) {
      const library = libraries[i]
      if (library.displayOrder !== i + 1) {
        Logger.debug(`[Library] Updating display order of library from ${library.displayOrder} to ${i + 1}`)
        await library.update({ displayOrder: i + 1 }).catch((error) => {
          Logger.error(`[Library] Failed to update library display order to ${i + 1}`, error)
        })
      }
    }
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
        displayOrder: DataTypes.INTEGER,
        icon: DataTypes.STRING,
        mediaType: DataTypes.STRING,
        provider: DataTypes.STRING,
        lastScan: DataTypes.DATE,
        lastScanVersion: DataTypes.STRING,
        settings: DataTypes.JSON,
        extraData: DataTypes.JSON
      },
      {
        sequelize,
        modelName: 'library'
      }
    )
  }

  get isPodcast(): NonAttribute<boolean> {
    return this.mediaType === 'podcast'
  }
  get isBook(): NonAttribute<boolean> {
    return this.mediaType === 'book'
  }
  get lastScanMetadataPrecedence(): NonAttribute<string[]> {
    return this.extraData?.lastScanMetadataPrecedence || []
  }

  get librarySettings(): NonAttribute<LibrarySettingsObject> {
    return this.settings || Library.getDefaultLibrarySettingsForMediaType(this.mediaType)
  }

  /**
   * TODO: Update to use new model
   */
  toOldJSON() {
    return {
      id: this.id,
      name: this.name,
      folders: (this.libraryFolders || []).map((f) => f.toOldJSON()),
      displayOrder: this.displayOrder,
      icon: this.icon,
      mediaType: this.mediaType,
      provider: this.provider,
      settings: {
        ...this.settings
      },
      lastScan: this.lastScan?.valueOf() || null,
      lastScanVersion: this.lastScanVersion,
      createdAt: this.createdAt.valueOf(),
      lastUpdate: this.updatedAt.valueOf()
    }
  }
}

namespace Library {
  export type LibrarySettingsObject = ModelTypes.LibrarySettingsObject
}

export = Library
