/**
 * Types shared by the library query helpers in server/utils/queries.
 */
import type { OrderItem, WhereAttributeHash } from 'sequelize'
import type Sequelize = require('sequelize')
import type LibraryItem = require('../../models/LibraryItem')
import type Feed = require('../../models/Feed')

/**
 * Named replacements for the raw SQL literals in a query
 */
export type QueryReplacements = Record<string, unknown>

/**
 * Where options and replacements used to restrict items to what a user can access
 */
/**
 * One where condition: an attribute hash or a Sequelize.where(...) condition
 */
export type WhereItem = WhereAttributeHash | ReturnType<typeof Sequelize.where>

export interface UserPermissionPodcastWhere {
  podcastWhere: WhereItem[]
  replacements: QueryReplacements
}

export interface UserPermissionBookWhere {
  bookWhere: WhereItem[]
  replacements: QueryReplacements
}

/**
 * Where options and replacements for a media filter group
 */
export interface MediaGroupQuery {
  mediaWhere: Record<string, unknown>
  replacements: QueryReplacements
}

/**
 * Library item model returned by the filter queries, with the properties the queries attach to it
 */
export type FilteredLibraryItem = LibraryItem & {
  feeds?: Feed[]
  rssFeed?: Feed
  numEpisodesIncomplete?: number
  recentEpisode?: unknown
  [key: string]: unknown
}

/**
 * User permissions JSON column (only the fields read by the queries)
 */
export interface UserPermissions {
  accessAllTags?: boolean
  itemTagsSelected?: string[]
  selectedTagsNotAccessible?: boolean
  accessExplicitContent?: boolean
}

/**
 * Find options as the query helpers build them. Sequelize accepts these at runtime but its types are stricter
 * (arrays of where options, a null limit, single nested include objects, [literal] order items),
 * so they are cast to the sequelize options type where they are passed to a model.
 */
export interface QueryFindOptions {
  where?: unknown
  replacements?: QueryReplacements
  include?: unknown
  attributes?: unknown
  order?: unknown
  limit?: number | null
  offset?: number
  distinct?: boolean
  subQuery?: boolean
  benchmark?: boolean
  logging?: (sql: string, timing?: number) => void
}

type Literal = ReturnType<typeof Sequelize.literal>

/**
 * Order item as the queries build them. Sequelize also accepts an item with only a literal (which holds the direction)
 */
export type QueryOrderItem = OrderItem | [Literal]

/**
 * Include options as the queries build them (see QueryFindOptions)
 */
export type QueryInclude = Record<string, unknown>
