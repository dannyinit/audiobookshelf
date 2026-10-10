/**
 * Statics that node_modules/sequelize/lib/sequelize.js sets on the Sequelize class (and its prototype)
 * at runtime, but that Sequelize's types (v6.35) only export from the module:
 * - `Sequelize.Op = Op`
 * - `Sequelize.prototype.QueryTypes = Sequelize.QueryTypes = QueryTypes`
 * - `Sequelize.DataTypes = DataTypes`, then `Sequelize[dataType] = DataTypes[dataType]` for every data type
 * Only the data types that sequelize/types/data-types.d.ts declares as values are listed here.
 * Type-only module augmentation (emits nothing); referenced from server/utils/types.ts.
 */
import type { DataTypes as SequelizeDataTypes, Op as SequelizeOp, QueryTypes as SequelizeQueryTypes } from 'sequelize'

declare module 'sequelize/types/sequelize' {
  interface Sequelize {
    QueryTypes: typeof SequelizeQueryTypes
  }

  namespace Sequelize {
    export const Op: typeof SequelizeOp
    export const QueryTypes: typeof SequelizeQueryTypes
    export const DataTypes: typeof SequelizeDataTypes
    export const ABSTRACT: typeof SequelizeDataTypes.ABSTRACT
    export const STRING: typeof SequelizeDataTypes.STRING
    export const CHAR: typeof SequelizeDataTypes.CHAR
    export const TEXT: typeof SequelizeDataTypes.TEXT
    export const NUMBER: typeof SequelizeDataTypes.NUMBER
    export const TINYINT: typeof SequelizeDataTypes.TINYINT
    export const SMALLINT: typeof SequelizeDataTypes.SMALLINT
    export const MEDIUMINT: typeof SequelizeDataTypes.MEDIUMINT
    export const INTEGER: typeof SequelizeDataTypes.INTEGER
    export const BIGINT: typeof SequelizeDataTypes.BIGINT
    export const FLOAT: typeof SequelizeDataTypes.FLOAT
    export const REAL: typeof SequelizeDataTypes.REAL
    export const DOUBLE: typeof SequelizeDataTypes.DOUBLE
    export const DECIMAL: typeof SequelizeDataTypes.DECIMAL
    export const BOOLEAN: typeof SequelizeDataTypes.BOOLEAN
    export const TIME: typeof SequelizeDataTypes.TIME
    export const DATE: typeof SequelizeDataTypes.DATE
    export const DATEONLY: typeof SequelizeDataTypes.DATEONLY
    export const HSTORE: typeof SequelizeDataTypes.HSTORE
    export const JSON: typeof SequelizeDataTypes.JSON
    export const JSONB: typeof SequelizeDataTypes.JSONB
    export const NOW: typeof SequelizeDataTypes.NOW
    export const BLOB: typeof SequelizeDataTypes.BLOB
    export const RANGE: typeof SequelizeDataTypes.RANGE
    export const UUID: typeof SequelizeDataTypes.UUID
    export const UUIDV1: typeof SequelizeDataTypes.UUIDV1
    export const UUIDV4: typeof SequelizeDataTypes.UUIDV4
    export const VIRTUAL: typeof SequelizeDataTypes.VIRTUAL
    export const ENUM: typeof SequelizeDataTypes.ENUM
    export const ARRAY: typeof SequelizeDataTypes.ARRAY
    export const GEOMETRY: typeof SequelizeDataTypes.GEOMETRY
    export const GEOGRAPHY: typeof SequelizeDataTypes.GEOGRAPHY
    export const CIDR: typeof SequelizeDataTypes.CIDR
    export const INET: typeof SequelizeDataTypes.INET
    export const MACADDR: typeof SequelizeDataTypes.MACADDR
    export const CITEXT: typeof SequelizeDataTypes.CITEXT
    export const TSVECTOR: typeof SequelizeDataTypes.TSVECTOR
  }
}
