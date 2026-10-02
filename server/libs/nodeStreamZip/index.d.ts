// Type declarations for the vendored node-stream-zip module (async API used by the server)
/// <reference types="node" />

interface StreamZipOptions {
  /** File to read */
  file: string
  /** Read entries, default true */
  storeEntries?: boolean
  skipEntryNameValidation?: boolean
  chunkSize?: number
}

interface ZipEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
  comment: string
  size: number
  compressedSize: number
  time: number
}

declare class StreamZipAsync {
  constructor(config: StreamZipOptions)
  entriesCount: Promise<number>
  comment: Promise<string>
  entry(name: string): Promise<ZipEntry | undefined>
  entries(): Promise<{ [name: string]: ZipEntry }>
  entryData(entry: string | ZipEntry): Promise<Buffer>
  stream(entry: string | ZipEntry): Promise<NodeJS.ReadableStream>
  /** Extracts an entry (or the whole archive when entry is null) and resolves with the number of extracted files */
  extract(entry: string | ZipEntry | null, outPath: string): Promise<number | undefined>
  on(event: string, handler: (...args: any[]) => void): void
  close(): Promise<void>
}

declare namespace StreamZip {
  type Options = StreamZipOptions
  type Entry = ZipEntry
  type Async = StreamZipAsync
}

declare const StreamZip: {
  async: typeof StreamZipAsync
}

export = StreamZip
