// Type declarations for the vendored node-ffprobe module
declare const ffprobe: {
  /** Runs ffprobe on the file and resolves with its parsed json output */
  (file: string): Promise<Record<string, any>>
  /** Path to the ffprobe binary, defaults to `ffprobe` on PATH */
  FFPROBE_PATH?: string
}

export = ffprobe
