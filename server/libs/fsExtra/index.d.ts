// Type declarations for the vendored (trimmed) fs-extra module.
// It re-exports graceful-fs with the async methods below "universalified" (callback or promise),
// plus the copy/empty/ensure/mkdirs/move/path-exists/remove helpers.
import type * as nodeFs from 'fs'
import type * as nodeFsPromises from 'fs/promises'

type UniversalifiedMethod =
  | 'access'
  | 'appendFile'
  | 'chmod'
  | 'chown'
  | 'close'
  | 'copyFile'
  | 'fchmod'
  | 'fchown'
  | 'fdatasync'
  | 'fstat'
  | 'fsync'
  | 'ftruncate'
  | 'futimes'
  | 'lchmod'
  | 'lchown'
  | 'link'
  | 'lstat'
  | 'mkdir'
  | 'mkdtemp'
  | 'open'
  | 'opendir'
  | 'readdir'
  | 'readFile'
  | 'readlink'
  | 'realpath'
  | 'rename'
  | 'rm'
  | 'rmdir'
  | 'stat'
  | 'symlink'
  | 'truncate'
  | 'unlink'
  | 'utimes'
  | 'writeFile'

type PromiseMethods = {
  [K in Exclude<UniversalifiedMethod, 'close' | 'fchmod' | 'fchown' | 'fdatasync' | 'fstat' | 'fsync' | 'ftruncate' | 'futimes'>]: K extends keyof typeof nodeFsPromises ? (typeof nodeFsPromises)[K] : never
}

type FsExtraFs = Omit<typeof nodeFs, keyof PromiseMethods> & {
  [K in keyof PromiseMethods]: K extends keyof typeof nodeFs ? (typeof nodeFs)[K] & PromiseMethods[K] : never
}

interface CopyOptions {
  dereference?: boolean
  overwrite?: boolean
  preserveTimestamps?: boolean
  errorOnExist?: boolean
  filter?: (src: string, dest: string) => boolean | Promise<boolean>
}

interface MoveOptions {
  overwrite?: boolean
}

interface FsExtraHelpers {
  copy(src: string, dest: string, options?: CopyOptions): Promise<void>
  copySync(src: string, dest: string, options?: CopyOptions): void

  emptyDir(dir: string): Promise<void>
  emptydir(dir: string): Promise<void>
  emptyDirSync(dir: string): void
  emptydirSync(dir: string): void

  createFile(file: string): Promise<void>
  createFileSync(file: string): void
  ensureFile(file: string): Promise<void>
  ensureFileSync(file: string): void
  createLink(src: string, dest: string): Promise<void>
  createLinkSync(src: string, dest: string): void
  ensureLink(src: string, dest: string): Promise<void>
  ensureLinkSync(src: string, dest: string): void
  createSymlink(src: string, dest: string, type?: string): Promise<void>
  createSymlinkSync(src: string, dest: string, type?: string): void
  ensureSymlink(src: string, dest: string, type?: string): Promise<void>
  ensureSymlinkSync(src: string, dest: string, type?: string): void

  mkdirs(dir: string, options?: { mode?: number }): Promise<void>
  mkdirsSync(dir: string, options?: { mode?: number }): void
  mkdirp(dir: string, options?: { mode?: number }): Promise<void>
  mkdirpSync(dir: string, options?: { mode?: number }): void
  ensureDir(dir: string, options?: { mode?: number }): Promise<void>
  ensureDirSync(dir: string, options?: { mode?: number }): void

  move(src: string, dest: string, options?: MoveOptions): Promise<void>
  moveSync(src: string, dest: string, options?: MoveOptions): void

  pathExists(path: string): Promise<boolean>
  pathExistsSync(path: string): boolean

  remove(path: string): Promise<void>
  removeSync(path: string): void
}

declare const fsExtra: FsExtraFs & FsExtraHelpers

export = fsExtra
