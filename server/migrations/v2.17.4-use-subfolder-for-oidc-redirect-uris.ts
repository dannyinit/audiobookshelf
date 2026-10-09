import type { QueryInterface } from 'sequelize'
import type { MigrationContext, MigrationOptions } from './types'

/**
 * The server settings JSON stored in the settings table (the keys this migration reads or writes)
 */
interface StoredServerSettings {
  authActiveAuthMethods?: string[]
  authOpenIDSubfolderForRedirectURLs?: string
}

/**
 * This upward migration adds an subfolder setting for OIDC redirect URIs.
 * It updates existing OIDC setups to set this option to None (empty subfolder), so they continue to work as before.
 * IF OIDC is not enabled, no action is taken (i.e. the subfolder is left undefined),
 * so that future OIDC setups will use the default subfolder.
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  // Upwards migration script
  logger.info('[2.17.4 migration] UPGRADE BEGIN: 2.17.4-use-subfolder-for-oidc-redirect-uris')

  const serverSettings = await getServerSettings(queryInterface, logger)
  if (serverSettings.authActiveAuthMethods?.includes('openid')) {
    logger.info('[2.17.4 migration] OIDC is enabled, adding authOpenIDSubfolderForRedirectURLs to server settings')
    serverSettings.authOpenIDSubfolderForRedirectURLs = ''
    await updateServerSettings(queryInterface, logger, serverSettings)
  } else {
    logger.info('[2.17.4 migration] OIDC is not enabled, no action required')
  }

  logger.info('[2.17.4 migration] UPGRADE END: 2.17.4-use-subfolder-for-oidc-redirect-uris')
}

/**
 * This downward migration script removes the subfolder setting for OIDC redirect URIs.
 *
 * @param options - an object containing the migration context.
 * @returns A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }: MigrationOptions): Promise<void> {
  // Downward migration script
  logger.info('[2.17.4 migration] DOWNGRADE BEGIN: 2.17.4-use-subfolder-for-oidc-redirect-uris ')

  // Remove the OIDC subfolder option from the server settings
  const serverSettings = await getServerSettings(queryInterface, logger)
  if (serverSettings.authOpenIDSubfolderForRedirectURLs !== undefined) {
    logger.info('[2.17.4 migration] Removing authOpenIDSubfolderForRedirectURLs from server settings')
    delete serverSettings.authOpenIDSubfolderForRedirectURLs
    await updateServerSettings(queryInterface, logger, serverSettings)
  } else {
    logger.info('[2.17.4 migration] authOpenIDSubfolderForRedirectURLs not found in server settings, no action required')
  }

  logger.info('[2.17.4 migration] DOWNGRADE END: 2.17.4-use-subfolder-for-oidc-redirect-uris ')
}

async function getServerSettings(queryInterface: QueryInterface, logger: MigrationContext['logger']): Promise<StoredServerSettings> {
  const result = await queryInterface.sequelize.query('SELECT value FROM settings WHERE key = "server-settings";')
  if (!result[0].length) {
    logger.error('[2.17.4 migration] Server settings not found')
    throw new Error('Server settings not found')
  }

  let serverSettings: StoredServerSettings | null = null
  try {
    // cast(b): Sequelize types raw query rows as unknown; the query selects the value column
    serverSettings = JSON.parse((result[0][0] as { value: string }).value)
  } catch (error) {
    logger.error('[2.17.4 migration] Error parsing server settings:', error)
    throw error
  }

  // set by the try block (the catch rethrows)
  return serverSettings!
}

async function updateServerSettings(queryInterface: QueryInterface, logger: MigrationContext['logger'], serverSettings: StoredServerSettings) {
  await queryInterface.sequelize.query('UPDATE settings SET value = :value WHERE key = "server-settings";', {
    replacements: {
      value: JSON.stringify(serverSettings)
    }
  })
}

export = { up, down }
