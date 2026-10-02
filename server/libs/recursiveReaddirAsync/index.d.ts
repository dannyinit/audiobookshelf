// Type declarations for the vendored recursive-readdir-async module (only the API used by the server)
export declare const LIST: 1
export declare const TREE: 2

export interface ListOptions {
  mode?: typeof LIST | typeof TREE
  recursive?: boolean
  stats?: boolean
  ignoreFolders?: boolean
  extensions?: boolean
  deep?: boolean
  realPath?: boolean
  normalizePath?: boolean
}

export interface ListItem {
  name: string
  path: string
  fullname: string
  extension?: string
  deep?: number
  isDirectory?: boolean
  error?: unknown
}

/** Resolves with the file list, or with `{ error, path }` when the root directory can't be read */
export declare function list(path: string, options?: ListOptions): Promise<ListItem[] & { error?: unknown }>
