// Type declarations for the vendored archiver module (only the API used by the server)
import type { Transform, Readable } from 'stream'

declare namespace archiver {
  interface ArchiverError extends Error {
    code: string
    data?: unknown
  }

  interface ArchiverOptions {
    zlib?: { level?: number }
    store?: boolean
  }

  interface EntryData {
    name: string
    prefix?: string
    date?: Date | string
    mode?: number
    stats?: import('fs').Stats
  }

  interface Archiver extends Transform {
    append(source: Readable | Buffer | string, data: EntryData): this
    directory(dirpath: string, destpath: string | false, data?: Partial<EntryData>): this
    file(filepath: string, data: EntryData): this
    finalize(): Promise<void>
    abort(): this
    pointer(): number
    on(event: 'error' | 'warning', listener: (error: ArchiverError) => void): this
    on(event: string | symbol, listener: (...args: any[]) => void): this
  }
}

declare function archiver(format: 'zip' | 'tar' | 'json', options?: archiver.ArchiverOptions): archiver.Archiver

export = archiver
