/**
 * Typed access to an object property by a key that is only known at runtime (metadata keys in the scanner).
 * Each function does exactly the property access `obj[key]` (no own-property check, no copy, no conversion).
 */

/**
 * Reads `obj[key]`
 */
function getKey(obj: object, key: string): unknown {
  // cast(d): dynamic metadata key; any object can be read by a string key
  return (obj as Record<string, unknown>)[key]
}

/**
 * Writes `obj[key] = value`
 */
function setKey(obj: object, key: string, value: unknown): void {
  // cast(d): dynamic metadata key; any object can be written by a string key
  const values = obj as Record<string, unknown>
  values[key] = value
}

export = { getKey, setKey }
