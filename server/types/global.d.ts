// Ambient (script) declarations: this file intentionally has no top-level import/export.

// Process-wide settings assigned during server startup (see Server.ts and index.ts)
declare var appRoot: string
declare var Source: string
declare var isWin: boolean
declare var ConfigPath: string
declare var MetadataPath: string
declare var RouterBasePath: string
declare var XAccel: string | undefined
declare var AllowCors: boolean
declare var PodcastDownloadTimeout: number
declare var MaxFailedEpisodeChecks: number
/** Returns true when the SSRF request filter should be bypassed for the url */
declare var DisableSsrfRequestFilter: ((url: string) => boolean) | undefined
/** Snapshot of the current server settings, refreshed whenever settings are saved */
declare var ServerSettings: ReturnType<import('../objects/settings/ServerSettings')['toJSON']>

type AbsUserModel = import('../models/User')

declare namespace Express {
  // Authenticated requests carry the User model (set by passport / Auth middleware)
  interface User extends AbsUserModel {}
}
