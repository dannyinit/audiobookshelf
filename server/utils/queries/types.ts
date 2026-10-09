/**
 * Types shared by the library query helpers in server/utils/queries.
 */
import type { FindAttributeOptions, FindOptions, Includeable, IncludeOptions, Order, OrderItem, WhereAttributeHash, WhereOptions } from 'sequelize'
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

type Literal = ReturnType<typeof Sequelize.literal>

/**
 * Order item as the queries build them. Sequelize also accepts an item with only a literal (which holds the direction)
 */
export type QueryOrderItem = OrderItem | [Literal]

/**
 * Include options as the queries build them: Sequelize's IncludeOptions, with the options that Sequelize v6 accepts
 * at runtime in more shapes than its types allow (see RuntimeFindOptions). Every other option keeps the Sequelize type.
 */
export interface QueryInclude extends Omit<IncludeOptions, 'where' | 'attributes' | 'limit' | 'include' | 'order'> {
  where?: WhereOptions | null
  attributes?: FindAttributeOptions | null
  limit?: number | null
  // A single nested include object is accepted as well as an array
  include?: Includeable | QueryInclude | (Includeable | QueryInclude)[]
  order?: Order | QueryOrderItem[]
}

/**
 * Find options as the query helpers build them: Sequelize's FindOptions, with the options relaxed to the shapes
 * Sequelize v6 accepts at runtime but its types reject: where, attributes and limit may be null, a nested include
 * may be a single object instead of an array, order items may be [literal], and distinct (a count option) is
 * allowed (findAll ignores it). Every other option keeps the Sequelize type. Each relaxed option is a superset of
 * the Sequelize one, so these options are cast to FindOptions / CountOptions with a plain `as` where they are passed to a model.
 */
export interface RuntimeFindOptions extends Omit<FindOptions, 'where' | 'attributes' | 'limit' | 'include' | 'order'> {
  where?: WhereOptions | null
  attributes?: FindAttributeOptions | null
  limit?: number | null
  include?: Includeable | QueryInclude | (Includeable | QueryInclude)[]
  order?: Order | QueryOrderItem[]
  distinct?: boolean
}
