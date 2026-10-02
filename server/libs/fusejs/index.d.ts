// Type declarations for the vendored Fuse.js (basic build, only the API used by the server)
declare namespace Fuse {
  interface FuseOptionKeyObject {
    name: string
    weight?: number
  }

  interface IFuseOptions {
    keys?: (string | FuseOptionKeyObject)[]
    threshold?: number
    ignoreDiacritics?: boolean
    includeScore?: boolean
    isCaseSensitive?: boolean
    shouldSort?: boolean
    minMatchCharLength?: number
  }

  interface FuseResult<T> {
    item: T
    refIndex: number
    score?: number
  }
}

declare class Fuse<T> {
  constructor(list: readonly T[], options?: Fuse.IFuseOptions)
  search(pattern: string, options?: { limit?: number }): Fuse.FuseResult<T>[]
}

export = Fuse
