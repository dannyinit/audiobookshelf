/**
 * Types shared by the controllers in server/controllers.
 */
import type { Request } from 'express'

type User = import('../models/User')

/**
 * Request after the auth middleware has set req.user (every /api route)
 */
export type RequestWithUser = Request & { user: User }
