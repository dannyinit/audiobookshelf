// Type declarations for the vendored fast-sort module
type SortByFn<T> = (item: T) => any
type SortBy<T> = keyof T | SortByFn<T> | (keyof T | SortByFn<T>)[]

interface SortByObject<T> {
  asc?: SortBy<T> | true
  desc?: SortBy<T> | true
  comparer?: (a: any, b: any) => number
}

interface Sorter<T> {
  asc(sortBy?: SortBy<T>): T[]
  desc(sortBy?: SortBy<T>): T[]
  by(sortBy: SortByObject<T> | SortByObject<T>[] | Record<string, SortByFn<T>> | Record<string, SortByFn<T>>[]): T[]
}

export interface ISortInstanceOptions {
  comparer?: (a: any, b: any, order: 1 | -1) => number
  inPlaceSorting?: boolean
}

export declare function createNewSortInstance(opts: ISortInstanceOptions): <T>(input: readonly T[]) => Sorter<T>
export declare function sort<T>(input: readonly T[]): Sorter<T>
export declare function inPlaceSort<T>(input: T[]): Sorter<T>
