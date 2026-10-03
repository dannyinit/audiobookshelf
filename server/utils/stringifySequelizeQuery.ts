function stringifySequelizeQuery(findOptions: unknown): string {
  function isClass(func: unknown): func is Function {
    return typeof func === 'function' && /^class\s/.test(func.toString())
  }

  function replacer(key: string, value: unknown): unknown {
    if (typeof value === 'object' && value !== null) {
      const symbols = Object.getOwnPropertySymbols(value).reduce((acc: Record<string, unknown>, sym) => {
        // Indexing by a symbol own property of the object
        acc[sym.toString()] = (value as Record<symbol, unknown>)[sym]
        return acc
      }, {})

      return { ...value, ...symbols }
    }

    if (isClass(value)) {
      return `${value.name}`
    }

    return value
  }

  return JSON.stringify(findOptions, replacer)
}
export = stringifySequelizeQuery
