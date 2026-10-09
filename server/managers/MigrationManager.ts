import umzugModule = require('../libs/umzug')
import sequelizeModule = require('sequelize')
import semver = require('semver')
import path = require('path')
import Module = require('module')
import fs = require('../libs/fsExtra')
import Logger = require('../Logger')
// cast(b): sequelize sets QueryTypes on the Sequelize class at runtime; its types only export it from the module
const { Sequelize, DataTypes } = sequelizeModule as typeof sequelizeModule & { Sequelize: { QueryTypes: typeof sequelizeModule.QueryTypes } }

/**
 * Migration as the vendored umzug lists it
 */
interface UmzugMigration {
  name: string
}

interface UmzugOptions {
  migrations:
    | {
        files: string[]
        resolve: (params: { path: string; name: string }) => { name: string; path: string; up: unknown; down: unknown }
      }
    | (() => Promise<UmzugMigration[]>)
  context?: unknown
  storage?: unknown
  logger?: unknown
}

interface UmzugInstance {
  options: UmzugOptions
  migrations(): Promise<UmzugMigration[]>
  executed(): Promise<UmzugMigration[]>
  up(options: { migrations: string[]; rerun: string }): Promise<unknown>
  down(options: { migrations: string[]; rerun: string }): Promise<unknown>
}

/**
 * The parts of the vendored umzug (server/libs/umzug) used here
 */
interface UmzugModule {
  Umzug: new (options: UmzugOptions) => UmzugInstance
  SequelizeStorage: new (options: { sequelize: sequelizeModule.Sequelize }) => unknown
}

// cast(a): the vendored umzug re-exports its modules at runtime (__exportStar), which TypeScript does not follow
const { Umzug, SequelizeStorage } = umzugModule as unknown as UmzugModule

/**
 * Node's internal module API used to load a migration script as if it were in the migrations source dir
 */
type InternalModule = Module & { _compile(content: string, filename: string): void }
type InternalModuleStatic = typeof Module & { _nodeModulePaths(from: string): string[] }

class MigrationManager {
  static MIGRATIONS_META_TABLE = 'migrationsMeta'

  declare sequelize: sequelizeModule.Sequelize
  declare isDatabaseNew: boolean
  declare configPath: string
  declare migrationsSourceDir: string
  declare initialized: boolean
  declare migrationsDir: string | null
  declare maxVersion: string | null
  declare databaseVersion: string | null
  declare serverVersion: string | null
  declare umzug: UmzugInstance | null

  /**
   * @param [configPath]
   */
  // NOTE: the default reads global.configPath, which is never set (the global is ConfigPath); Database passes the config path, so the default is not used
  // cast(c): read as in the JS (see NOTE above)
  constructor(sequelize: sequelizeModule.Sequelize, isDatabaseNew: boolean, configPath = (global as typeof globalThis & { configPath?: string }).configPath) {
    if (!sequelize || !(sequelize instanceof Sequelize)) throw new Error('Sequelize instance is required for MigrationManager.')
    this.sequelize = sequelize
    this.isDatabaseNew = isDatabaseNew
    if (!configPath) throw new Error('Config path is required for MigrationManager.')
    this.configPath = configPath
    this.migrationsSourceDir = path.join(__dirname, '..', 'migrations')
    this.initialized = false
    this.migrationsDir = null
    this.maxVersion = null
    this.databaseVersion = null
    this.serverVersion = null
    this.umzug = null
  }

  /**
   * Init version vars and copy migration files to config dir if necessary
   */
  async init(serverVersion: string) {
    if (!(await fs.pathExists(this.configPath))) throw new Error(`Config path does not exist: ${this.configPath}`)

    this.migrationsDir = path.join(this.configPath, 'migrations')
    try {
      await fs.ensureDir(this.migrationsDir)
    } catch (error) {
      // cast(d): catch variable is unknown
      Logger.error(`[MigrationManager] Failed to create migrations directory at "${this.migrationsDir}": ${(error as Error).message}`)
      throw new Error(`[MigrationManager] Failed to create migrations directory at "${this.migrationsDir}"`, { cause: error })
    }

    this.serverVersion = this.extractVersionFromTag(serverVersion)
    if (!this.serverVersion) throw new Error(`Invalid server version: ${serverVersion}. Expected a version tag like v1.2.3.`)

    await this.fetchVersionsFromDatabase()
    if (!this.maxVersion || !this.databaseVersion) throw new Error('Failed to fetch versions from the database.')
    Logger.debug(`[MigrationManager] Database version: ${this.databaseVersion}, Max version: ${this.maxVersion}, Server version: ${this.serverVersion}`)

    if (semver.gt(this.serverVersion, this.maxVersion)) {
      try {
        await this.copyMigrationsToConfigDir()
      } catch (error) {
        throw new Error('Failed to copy migrations to the config directory.', { cause: error })
      }

      try {
        await this.updateMaxVersion()
      } catch (error) {
        throw new Error('Failed to update max version in the database.', { cause: error })
      }
    }

    this.initialized = true
  }

  async runMigrations() {
    if (!this.initialized) throw new Error('MigrationManager is not initialized. Call init() first.')

    if (this.isDatabaseNew) {
      Logger.info('[MigrationManager] Database is new. Skipping migrations.')
      return
    }

    // Both are set by init (checked above)
    const versionCompare = semver.compare(this.serverVersion!, this.databaseVersion!)
    if (versionCompare == 0) {
      Logger.info('[MigrationManager] Database is already up to date.')
      return
    }

    await this.initUmzug()
    // Set by initUmzug
    const migrations = await this.umzug!.migrations()
    // Set by initUmzug
    const executedMigrations = (await this.umzug!.executed()).map((m) => m.name)

    const migrationDirection = versionCompare == 1 ? 'up' : 'down'

    let migrationsToRun: string[] = []
    migrationsToRun = this.findMigrationsToRun(migrations, executedMigrations, migrationDirection)

    // Only proceed with migration if there are migrations to run
    if (migrationsToRun.length > 0) {
      const originalDbPath = path.join(this.configPath, 'absdatabase.sqlite')
      const backupDbPath = path.join(this.configPath, 'absdatabase.backup.sqlite')
      try {
        Logger.info(`[MigrationManager] Migrating database ${migrationDirection} to version ${this.serverVersion}`)
        Logger.info(`[MigrationManager] Migrations to run: ${migrationsToRun.join(', ')}`)
        // Create a backup copy of the SQLite database before starting migrations
        await fs.copy(originalDbPath, backupDbPath)
        Logger.info('Created a backup of the original database.')

        // Run migrations
        // Set by initUmzug
        await this.umzug![migrationDirection]({ migrations: migrationsToRun, rerun: 'ALLOW' })

        // Clean up the backup
        await fs.remove(backupDbPath)

        Logger.info('[MigrationManager] Migrations successfully applied to the original database.')
      } catch (error) {
        Logger.error('[MigrationManager] Migration failed:', error)

        await this.sequelize.close()

        // Step 3: If migration fails, save the failed original and restore the backup
        const failedDbPath = path.join(this.configPath, 'absdatabase.failed.sqlite')
        await fs.move(originalDbPath, failedDbPath, { overwrite: true })
        Logger.info('[MigrationManager] Saved the failed database as absdatabase.failed.sqlite.')

        await fs.move(backupDbPath, originalDbPath, { overwrite: true })
        Logger.info('[MigrationManager] Restored the original database from the backup.')

        Logger.info('[MigrationManager] Migration failed. Exiting Audiobookshelf with code 1.')
        process.exit(1)
      }
    } else {
      Logger.info('[MigrationManager] No migrations to run.')
    }

    await this.updateDatabaseVersion()
  }

  async initUmzug(umzugStorage: unknown = new SequelizeStorage({ sequelize: this.sequelize })) {
    // This check is for dependency injection in tests
    // migrationsDir is set by init
    const files = (await fs.readdir(this.migrationsDir!))
      .filter((file) => {
        // Only include .js files and exclude dot files
        return !file.startsWith('.') && path.extname(file).toLowerCase() === '.js'
      })
      // migrationsDir is set by init
      .map((file) => path.join(this.migrationsDir!, file))

    // Validate migration names
    for (const file of files) {
      const migrationName = path.basename(file, path.extname(file))
      const migrationVersion = this.extractVersionFromTag(migrationName)
      if (!migrationVersion) {
        throw new Error(`Invalid migration file: "${migrationName}". Unable to extract version from filename.`)
      }
    }

    const parent = new Umzug({
      migrations: {
        files,
        resolve: (params) => {
          // make script think it's in migrationsSourceDir
          const migrationPath = params.path
          const migrationName = params.name
          const contents = fs.readFileSync(migrationPath, 'utf8')
          const fakePath = path.join(this.migrationsSourceDir, path.basename(migrationPath))
          // cast(d): Node's internal module API (_compile) is not in the node types
          const module = new Module(fakePath) as InternalModule
          module.filename = fakePath
          // cast(d): Node's internal module API (_nodeModulePaths) is not in the node types
          module.paths = (Module as InternalModuleStatic)._nodeModulePaths(this.migrationsSourceDir)
          module._compile(contents, fakePath)
          const script = module.exports
          return {
            name: migrationName,
            path: migrationPath,
            up: script.up,
            down: script.down
          }
        }
      },
      context: { queryInterface: this.sequelize.getQueryInterface(), logger: Logger },
      storage: umzugStorage,
      logger: Logger
    })

    // Sort migrations by version
    this.umzug = new Umzug({
      ...parent.options,
      migrations: async () =>
        (await parent.migrations()).sort((a, b) => {
          const versionA = this.extractVersionFromTag(a.name)
          const versionB = this.extractVersionFromTag(b.name)
          // Migration names were validated above (each has a version)
          return semver.compare(versionA!, versionB!)
        })
    })
  }

  async fetchVersionsFromDatabase() {
    await this.checkOrCreateMigrationsMetaTable()

    const [{ version }] = await this.sequelize.query<{ version: string }>("SELECT value as version FROM :migrationsMeta WHERE key = 'version'", {
      replacements: { migrationsMeta: MigrationManager.MIGRATIONS_META_TABLE },
      type: Sequelize.QueryTypes.SELECT
    })
    this.databaseVersion = version

    const [{ maxVersion }] = await this.sequelize.query<{ maxVersion: string }>("SELECT value as maxVersion FROM :migrationsMeta WHERE key = 'maxVersion'", {
      replacements: { migrationsMeta: MigrationManager.MIGRATIONS_META_TABLE },
      type: Sequelize.QueryTypes.SELECT
    })
    this.maxVersion = maxVersion
  }

  async checkOrCreateMigrationsMetaTable() {
    const queryInterface = this.sequelize.getQueryInterface()
    let migrationsMetaTableExists = await queryInterface.tableExists(MigrationManager.MIGRATIONS_META_TABLE)

    // If the table exists, check that the `version` and `maxVersion` rows exist
    if (migrationsMetaTableExists) {
      const [{ count }] = await this.sequelize.query<{ count: number }>("SELECT COUNT(*) as count FROM :migrationsMeta WHERE key IN ('version', 'maxVersion')", {
        replacements: { migrationsMeta: MigrationManager.MIGRATIONS_META_TABLE },
        type: Sequelize.QueryTypes.SELECT
      })
      if (count < 2) {
        Logger.warn(`[MigrationManager] migrationsMeta table exists but is missing 'version' or 'maxVersion' row. Dropping it...`)
        await queryInterface.dropTable(MigrationManager.MIGRATIONS_META_TABLE)
        migrationsMetaTableExists = false
      }
    }

    if (this.isDatabaseNew && migrationsMetaTableExists) {
      Logger.warn(`[MigrationManager] migrationsMeta table already exists. Dropping it...`)
      // This can happen if database was initialized with force: true
      await queryInterface.dropTable(MigrationManager.MIGRATIONS_META_TABLE)
      migrationsMetaTableExists = false
    }

    if (!migrationsMetaTableExists) {
      await queryInterface.createTable(MigrationManager.MIGRATIONS_META_TABLE, {
        key: {
          type: DataTypes.STRING,
          allowNull: false
        },
        value: {
          type: DataTypes.STRING,
          allowNull: false
        }
      })
      await this.sequelize.query("INSERT INTO :migrationsMeta (key, value) VALUES ('version', :version), ('maxVersion', '0.0.0')", {
        replacements: { version: this.isDatabaseNew ? this.serverVersion : '0.0.0', migrationsMeta: MigrationManager.MIGRATIONS_META_TABLE },
        type: Sequelize.QueryTypes.INSERT
      })
      Logger.debug(`[MigrationManager] Created migrationsMeta table: "${MigrationManager.MIGRATIONS_META_TABLE}"`)
    }
  }

  extractVersionFromTag(tag: string | null | undefined) {
    if (!tag) return null
    const versionMatch = tag.match(/^v?(\d+\.\d+\.\d+)/)
    return versionMatch ? versionMatch[1] : null
  }

  async copyMigrationsToConfigDir() {
    if (!(await fs.pathExists(this.migrationsSourceDir))) return

    const files = await fs.readdir(this.migrationsSourceDir)
    await Promise.all(
      files
        .filter((file) => path.extname(file) === '.js')
        .map(async (file) => {
          const sourceFile = path.join(this.migrationsSourceDir, file)
          // migrationsDir is set by init
          const targetFile = path.join(this.migrationsDir!, file)
          await fs.copy(sourceFile, targetFile) // Asynchronously copy the files
        })
    )
    Logger.debug(`[MigrationManager] Copied migrations to the config directory: "${this.migrationsDir}"`)
  }

  /**
   * @param executedMigrations - names of executed migrations
   * @param direction - 'up' or 'down'
   * @returns names of migrations to run
   */
  findMigrationsToRun(migrations: { name: string }[], executedMigrations: string[], direction: string): string[] {
    const migrationsToRun = migrations
      .filter((migration) => {
        // initUmzug validated that every migration name has a version
        const migrationVersion = this.extractVersionFromTag(migration.name)!
        // The database and server versions are set by init
        if (direction === 'up') {
          return semver.gt(migrationVersion, this.databaseVersion!) && semver.lte(migrationVersion, this.serverVersion!) && !executedMigrations.includes(migration.name)
        } else {
          // A down migration should be run even if the associated up migration wasn't executed before
          return semver.lte(migrationVersion, this.databaseVersion!) && semver.gt(migrationVersion, this.serverVersion!)
        }
      })
      .map((migration) => migration.name)
    if (direction === 'down') {
      return migrationsToRun.reverse()
    } else {
      return migrationsToRun
    }
  }

  async updateMaxVersion() {
    try {
      await this.sequelize.query("UPDATE :migrationsMeta SET value = :maxVersion WHERE key = 'maxVersion'", {
        replacements: { maxVersion: this.serverVersion, migrationsMeta: MigrationManager.MIGRATIONS_META_TABLE },
        type: Sequelize.QueryTypes.UPDATE
      })
    } catch (error) {
      throw new Error('Failed to update maxVersion in the migrationsMeta table.', { cause: error })
    }
    this.maxVersion = this.serverVersion
  }

  async updateDatabaseVersion() {
    try {
      await this.sequelize.query("UPDATE :migrationsMeta SET value = :version WHERE key = 'version'", {
        replacements: { version: this.serverVersion, migrationsMeta: MigrationManager.MIGRATIONS_META_TABLE },
        type: Sequelize.QueryTypes.UPDATE
      })
    } catch (error) {
      throw new Error('Failed to update version in the migrationsMeta table.', { cause: error })
    }
    this.databaseVersion = this.serverVersion
  }
}

export = MigrationManager
