import type { QueryInterface } from 'sequelize'
import type { MigrationContext, MigrationOptions } from './types'

const migrationVersion = '2.17.7'
const migrationName = `${migrationVersion}-add-indices`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This upward migration adds some indices to the libraryItems and books tables to improve query performance
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  // Upwards migration script
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  await addIndex(queryInterface, logger, 'libraryItems', ['libraryId', 'mediaType', 'size'])
  await addIndex(queryInterface, logger, 'books', ['duration'])

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This downward migration script removes the indices added in the upward migration script
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  // Downward migration script
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  await removeIndex(queryInterface, logger, 'libraryItems', ['libraryId', 'mediaType', 'size'])
  await removeIndex(queryInterface, logger, 'books', ['duration'])

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

/**
 * Utility function to add an index to a table. If the index already exists, it logs a message and continues.
 *
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {import ('../Logger')} logger
 * @param {string} tableName
 * @param {string[]} columns
 */
async function addIndex(queryInterface: QueryInterface, logger: MigrationContext['logger'], tableName: string, columns: string[]) {
  try {
    logger.info(`${loggerPrefix} adding index [${columns.join(', ')}] to table "${tableName}"`)
    await queryInterface.addIndex(tableName, columns)
    logger.info(`${loggerPrefix} added index [${columns.join(', ')}] to table "${tableName}"`)
  } catch (error) {
    // cast(d) (2): catch variable is unknown
    if ((error as Error).name === 'SequelizeDatabaseError' && (error as Error).message.includes('already exists')) {
      logger.info(`${loggerPrefix} index [${columns.join(', ')}] for table "${tableName}" already exists`)
    } else {
      throw error
    }
  }
}

/**
 * Utility function to remove an index from a table.
 * Sequelize implemets it using DROP INDEX IF EXISTS, so it won't throw an error if the index doesn't exist.
 *
 * @param {import('sequelize').QueryInterface} queryInterface
 * @param {import ('../Logger')} logger
 * @param {string} tableName
 * @param {string[]} columns
 */
async function removeIndex(queryInterface: QueryInterface, logger: MigrationContext['logger'], tableName: string, columns: string[]) {
  logger.info(`${loggerPrefix} removing index [${columns.join(', ')}] from table "${tableName}"`)
  await queryInterface.removeIndex(tableName, columns)
  logger.info(`${loggerPrefix} removed index [${columns.join(', ')}] from table "${tableName}"`)
}

export = { up, down }
