import type { DataTypes as SequelizeDataTypes, Sequelize } from 'sequelize'
import type { MigrationOptions } from './types'

const migrationVersion = '2.17.6'
const migrationName = `${migrationVersion}-share-add-isdownloadable`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This migration script adds the isDownloadable column to the mediaItemShares table.
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  if (await queryInterface.tableExists('mediaItemShares')) {
    const tableDescription = await queryInterface.describeTable('mediaItemShares')
    if (!tableDescription.isDownloadable) {
      logger.info(`${loggerPrefix} Adding isDownloadable column to mediaItemShares table`)
      await queryInterface.addColumn('mediaItemShares', 'isDownloadable', {
        // cast(b): sequelize sets DataTypes on the Sequelize class at runtime; its types only export it from the module
        type: (queryInterface.sequelize.Sequelize as typeof Sequelize & { DataTypes: typeof SequelizeDataTypes }).DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      })
      logger.info(`${loggerPrefix} Added isDownloadable column to mediaItemShares table`)
    } else {
      logger.info(`${loggerPrefix} isDownloadable column already exists in mediaItemShares table`)
    }
  } else {
    logger.info(`${loggerPrefix} mediaItemShares table does not exist`)
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This migration script removes the isDownloadable column from the mediaItemShares table.
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  if (await queryInterface.tableExists('mediaItemShares')) {
    const tableDescription = await queryInterface.describeTable('mediaItemShares')
    if (tableDescription.isDownloadable) {
      logger.info(`${loggerPrefix} Removing isDownloadable column from mediaItemShares table`)
      await queryInterface.removeColumn('mediaItemShares', 'isDownloadable')
      logger.info(`${loggerPrefix} Removed isDownloadable column from mediaItemShares table`)
    } else {
      logger.info(`${loggerPrefix} isDownloadable column does not exist in mediaItemShares table`)
    }
  } else {
    logger.info(`${loggerPrefix} mediaItemShares table does not exist`)
  }

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

export = { up, down }
