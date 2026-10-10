import type { Request } from 'express'

/** One value of req.query, as Express's query parser gives it (a string, an array or a nested object) */
type QueryValue = Request['query'][string]

/**
 * Typed accessors for request query values.
 * Each function returns its argument unchanged: no conversion, no default, no validation,
 * no trimming and no array handling. Only the type changes, to the one the caller uses.
 */

/**
 * A query value the caller uses as an optional string
 * @param value
 */
function optionalString(value: QueryValue): string | undefined {
  // cast(d): query value; the caller uses it as a string or undefined (an array or object is returned as is)
  return value as string | undefined
}

/**
 * A query value the caller has checked is set and uses as a string
 * @param value
 */
function requiredString(value: QueryValue): string {
  // cast(d): query value; the caller has checked it is set and uses it as a string (an array or object is returned as is)
  return value as string
}

/**
 * A query value passed to isNaN, which converts any value with Number() itself
 * @param value
 */
function isNaNArgument(value: QueryValue): number {
  // cast(d): query value; isNaN is typed to take a number, but it converts its argument itself, so the raw value is returned as is
  return value as unknown as number
}

export = { optionalString, requiredString, isNaNArgument }
