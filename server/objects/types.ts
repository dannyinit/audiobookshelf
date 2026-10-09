/**
 * Types shared by the files in server/objects.
 */

/**
 * FileMetadata as stored in JSON (see metadata/FileMetadata toJSON)
 */
export interface FileMetadataJSON {
  filename: string
  ext: string
  path: string
  relPath: string
  size: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
}

/**
 * Chapter of an audio file or playback session
 */
export interface AudioChapter {
  id: number
  start: number
  end: number
  title: string
}

/**
 * Translatable string used for task titles, descriptions and errors
 */
export interface TaskString {
  text: string
  key: string
  /** Substitutions; the managers also pass numbers and missing (null or undefined) titles */
  subs?: (string | number | null | undefined)[]
}

/**
 * The vendored date-and-time (server/libs/dateAndTime) is a minified UMD bundle that TypeScript cannot type
 * (only the functions used). Files cast the required module to this type.
 */
export interface DateAndTime {
  format(dateObj: Date, formatString: string): string
}
