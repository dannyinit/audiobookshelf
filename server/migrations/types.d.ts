// Declaration file (emits no JavaScript): MigrationManager copies every .js file in the compiled migrations
// directory to the config directory and rejects a file whose name has no version, so a types.ts here would break startup.
import type { QueryInterface } from 'sequelize'
import Logger = require('../Logger')

/**
 * The context MigrationManager passes to every migration (`context` of the umzug options)
 */
export interface MigrationContext {
  /** a Sequelize QueryInterface object */
  queryInterface: QueryInterface
  /** a Logger object */
  logger: typeof Logger
}

export interface MigrationOptions {
  /** an object containing the migration context */
  context: MigrationContext
}
