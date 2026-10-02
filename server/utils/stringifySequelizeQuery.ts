function stringifySequelizeQuery(findOptions: unknown): string {
  function isClass(func: unknown) {
    return typeof func === 'function' && /^class\s/.test(func.toString())
  }

  function replacer(key: string, value: any) {
    if (typeof value === 'object' && value !== null) {
      const symbols = Object.getOwnPropertySymbols(value).reduce((acc: Record<string, unknown>, sym) => {
        acc[sym.toString()] = value[sym]
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
