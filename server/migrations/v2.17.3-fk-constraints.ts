import type { ColumnDescription, QueryInterface } from 'sequelize'
import type { MigrationOptions } from './types'

/**
 * This upward migration script changes foreign key constraints for the
 * libraryItems, feeds, mediaItemShares, playbackSessions, playlistMediaItems, and mediaProgresses tables.
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  // Upwards migration script
  logger.info('[2.17.3 migration] UPGRADE BEGIN: 2.17.3-fk-constraints')

  const execQuery = queryInterface.sequelize.query.bind(queryInterface.sequelize)

  // Disable foreign key constraints for the next sequence of operations
  await execQuery(`PRAGMA foreign_keys = OFF;`)

  try {
    await execQuery(`BEGIN TRANSACTION;`)

    logger.info('[2.17.3 migration] Updating libraryItems constraints')
    const libraryItemsConstraints = [
      { field: 'libraryId', onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      { field: 'libraryFolderId', onDelete: 'SET NULL', onUpdate: 'CASCADE' }
    ]
    if (await changeConstraints(queryInterface, 'libraryItems', libraryItemsConstraints)) {
      logger.info('[2.17.3 migration] Finished updating libraryItems constraints')
    } else {
      logger.info('[2.17.3 migration] No changes needed for libraryItems constraints')
    }

    logger.info('[2.17.3 migration] Updating feeds constraints')
    const feedsConstraints = [{ field: 'userId', onDelete: 'SET NULL', onUpdate: 'CASCADE' }]
    if (await changeConstraints(queryInterface, 'feeds', feedsConstraints)) {
      logger.info('[2.17.3 migration] Finished updating feeds constraints')
    } else {
      logger.info('[2.17.3 migration] No changes needed for feeds constraints')
    }

    if (await queryInterface.tableExists('mediaItemShares')) {
      logger.info('[2.17.3 migration] Updating mediaItemShares constraints')
      const mediaItemSharesConstraints = [{ field: 'userId', onDelete: 'SET NULL', onUpdate: 'CASCADE' }]
      if (await changeConstraints(queryInterface, 'mediaItemShares', mediaItemSharesConstraints)) {
        logger.info('[2.17.3 migration] Finished updating mediaItemShares constraints')
      } else {
        logger.info('[2.17.3 migration] No changes needed for mediaItemShares constraints')
      }
    } else {
      logger.info('[2.17.3 migration] mediaItemShares table does not exist, skipping column change')
    }

    logger.info('[2.17.3 migration] Updating playbackSessions constraints')
    const playbackSessionsConstraints = [
      { field: 'deviceId', onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      { field: 'libraryId', onDelete: 'SET NULL', onUpdate: 'CASCADE' },
      { field: 'userId', onDelete: 'SET NULL', onUpdate: 'CASCADE' }
    ]
    if (await changeConstraints(queryInterface, 'playbackSessions', playbackSessionsConstraints)) {
      logger.info('[2.17.3 migration] Finished updating playbackSessions constraints')
    } else {
      logger.info('[2.17.3 migration] No changes needed for playbackSessions constraints')
    }

    logger.info('[2.17.3 migration] Updating playlistMediaItems constraints')
    const playlistMediaItemsConstraints = [{ field: 'playlistId', onDelete: 'CASCADE', onUpdate: 'CASCADE' }]
    if (await changeConstraints(queryInterface, 'playlistMediaItems', playlistMediaItemsConstraints)) {
      logger.info('[2.17.3 migration] Finished updating playlistMediaItems constraints')
    } else {
      logger.info('[2.17.3 migration] No changes needed for playlistMediaItems constraints')
    }

    logger.info('[2.17.3 migration] Updating mediaProgresses constraints')
    const mediaProgressesConstraints = [{ field: 'userId', onDelete: 'CASCADE', onUpdate: 'CASCADE' }]
    if (await changeConstraints(queryInterface, 'mediaProgresses', mediaProgressesConstraints)) {
      logger.info('[2.17.3 migration] Finished updating mediaProgresses constraints')
    } else {
      logger.info('[2.17.3 migration] No changes needed for mediaProgresses constraints')
    }

    await execQuery(`COMMIT;`)
  } catch (error) {
    logger.error(`[2.17.3 migration] Migration failed - rolling back. Error:`, error)
    await execQuery(`ROLLBACK;`)
  }

  await execQuery(`PRAGMA foreign_keys = ON;`)

  // Completed migration
  logger.info('[2.17.3 migration] UPGRADE END: 2.17.3-fk-constraints')
}

/**
 * This downward migration script is a no-op.
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  // Downward migration script
  logger.info('[2.17.3 migration] DOWNGRADE BEGIN: 2.17.3-fk-constraints')

  // This migration is a no-op
  logger.info('[2.17.3 migration] No action required for downgrade')

  // Completed migration
  logger.info('[2.17.3 migration] DOWNGRADE END: 2.17.3-fk-constraints')
}

interface ConstraintUpdateObj {
  /** The field to update */
  field: string
  /** The onDelete constraint */
  onDelete: string
  /** The onUpdate constraint */
  onUpdate: string
}

interface SequelizeFKObj {
  references: { model: string; key: string }
  onDelete: string
  onUpdate: string
}

/**
 * A row of PRAGMA foreign_key_list (the columns read here)
 */
interface PragmaForeignKeyRow {
  from: string
  table: string
  to: string
  on_delete: string
  on_update: string
}

/**
 * A column of describeTable, with the updated foreign key constraint if the column has one
 */
type ColumnDescriptionWithFK = ColumnDescription & Partial<SequelizeFKObj>

/**
 * @param fk - The foreign key object from PRAGMA foreign_key_list
 * @returns The foreign key object formatted for Sequelize
 */
const formatFKsPragmaToSequelizeFK = (fk: PragmaForeignKeyRow): SequelizeFKObj => {
  return {
    references: {
      model: fk.table,
      key: fk.to
    },
    onDelete: fk['on_delete'],
    onUpdate: fk['on_update']
  }
}

async function getUpdatedForeignKeys(queryInterface: QueryInterface, tableName: string, constraints: ConstraintUpdateObj[]): Promise<Record<string, SequelizeFKObj> | null> {
  const execQuery = queryInterface.sequelize.query.bind(queryInterface.sequelize)
  const quotedTableName = queryInterface.quoteIdentifier(tableName)

  // cast(b): Sequelize types a raw query result as [rows, metadata]; the sqlite dialect returns only the rows for PRAGMA foreign_key_list
  const foreignKeys = (await execQuery(`PRAGMA foreign_key_list(${quotedTableName});`)) as unknown as PragmaForeignKeyRow[]

  let hasUpdates = false
  const foreignKeysByColName = foreignKeys.reduce<Record<string, SequelizeFKObj>>((prev, curr) => {
    const fk = formatFKsPragmaToSequelizeFK(curr)

    const constraint = constraints.find((c) => c.field === curr.from)
    if (constraint && (constraint.onDelete !== fk.onDelete || constraint.onUpdate !== fk.onUpdate)) {
      fk.onDelete = constraint.onDelete
      fk.onUpdate = constraint.onUpdate
      hasUpdates = true
    }

    return { ...prev, [curr.from]: fk }
  }, {})

  return hasUpdates ? foreignKeysByColName : null
}

/**
 * Extends the Sequelize describeTable function to include the updated foreign key constraints
 *
 * @param queryInterface
 * @param tableName
 * @param updatedForeignKeys
 */
async function describeTableWithFKs(queryInterface: QueryInterface, tableName: string, updatedForeignKeys: Record<string, SequelizeFKObj>) {
  const tableDescription = await queryInterface.describeTable(tableName)

  const tableDescriptionWithFks = Object.entries(tableDescription).reduce<Record<string, ColumnDescriptionWithFK>>((prev, [col, attributes]) => {
    let extendedAttributes: ColumnDescriptionWithFK = attributes

    if (updatedForeignKeys[col]) {
      extendedAttributes = {
        ...extendedAttributes,
        ...updatedForeignKeys[col]
      }
    }
    return { ...prev, [col]: extendedAttributes }
  }, {})

  return tableDescriptionWithFks
}

/**
 * @see https://www.sqlite.org/lang_altertable.html#otheralter
 * @see https://sequelize.org/docs/v6/other-topics/query-interface/#changing-and-removing-columns-in-sqlite
 *
 * @param queryInterface
 * @param tableName
 * @param constraints
 * @returns Return false if no changes are needed, true otherwise
 */
async function changeConstraints(queryInterface: QueryInterface, tableName: string, constraints: ConstraintUpdateObj[]): Promise<boolean> {
  const updatedForeignKeys = await getUpdatedForeignKeys(queryInterface, tableName, constraints)
  if (!updatedForeignKeys) {
    return false
  }

  const execQuery = queryInterface.sequelize.query.bind(queryInterface.sequelize)
  const quotedTableName = queryInterface.quoteIdentifier(tableName)

  const backupTableName = `${tableName}_${Math.round(Math.random() * 100)}_backup`
  const quotedBackupTableName = queryInterface.quoteIdentifier(backupTableName)

  try {
    const tableDescriptionWithFks = await describeTableWithFKs(queryInterface, tableName, updatedForeignKeys)

    // cast(b): Sequelize types queryGenerator as unknown; the sqlite query generator's attributesToSQL returns the column SQL by name
    const attributes = (queryInterface.queryGenerator as { attributesToSQL(attributes: Record<string, ColumnDescriptionWithFK>): Record<string, string> }).attributesToSQL(tableDescriptionWithFks)

    // Create the backup table
    await queryInterface.createTable(backupTableName, attributes)

    const attributeNames = Object.keys(attributes)
      .map((attr) => queryInterface.quoteIdentifier(attr))
      .join(', ')

    // Copy all data from the target table to the backup table
    await execQuery(`INSERT INTO ${quotedBackupTableName} SELECT ${attributeNames} FROM ${quotedTableName};`)

    // Drop the old (original) table
    await queryInterface.dropTable(tableName)

    // Rename the backup table to the original table's name
    await queryInterface.renameTable(backupTableName, tableName)

    // Validate that all foreign key constraints are correct
    const result = await execQuery(`PRAGMA foreign_key_check(${quotedTableName});`, {
      type: queryInterface.sequelize.Sequelize.QueryTypes.SELECT
    })

    // There are foreign key violations, exit
    if (result.length) {
      return Promise.reject(`Foreign key violations detected: ${JSON.stringify(result, null, 2)}`)
    }

    return true
  } catch (error) {
    return Promise.reject(error)
  }
}

export = { up, down }
