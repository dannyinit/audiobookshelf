import type { Request } from 'express'

/**
 * Whether the request was made over HTTPS.
 * Uses Express `req.secure` and `x-forwarded-proto`
 */
function isRequestSecure(req: Request): boolean {
  if (req.secure) return true
  const xfp = (req.get('x-forwarded-proto') || '').toLowerCase()
  // Nginx Proxy Manager sends "http, https"; see https://github.com/advplyr/audiobookshelf/pull/4635
  return (
    xfp === 'https' ||
    xfp
      .split(',')
      .map((s) => s.trim())
      .includes('https')
  )
}

function getRequestProtocol(req: Request): 'https' | 'http' {
  return isRequestSecure(req) ? 'https' : 'http'
}

function getRequestOrigin(req: Request): { protocol: 'https' | 'http'; host: string | undefined; origin: string } {
  const protocol = getRequestProtocol(req)
  const host = req.get('host')
  return { protocol, host, origin: `${protocol}://${host}` }
}

export = {
  isRequestSecure,
  getRequestProtocol,
  getRequestOrigin
}
