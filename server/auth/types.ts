/**
 * Types shared by the files in server/auth (and server/routers).
 */
type UserModel = import('../models/User')

declare global {
  namespace Express {
    /**
     * The user that passport sets on req.user is the User model instance (see the strategies' verify callbacks)
     */
    interface User extends UserModel {}
  }

  /** Router base path (set in Server.js from ROUTER_BASE_PATH) */
  var RouterBasePath: string
}

/**
 * Passport verify callback (only the arguments the strategies pass)
 */
export type PassportDone = (err: null, user: UserModel | null, info?: string) => void

/**
 * Decoded JWT payload of access, refresh and API key tokens (only the fields read)
 */
export interface JwtPayload {
  userId?: string
  username?: string
  type?: string
  keyId?: string
  exp?: number
}
