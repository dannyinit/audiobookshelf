/**
 * ssrf-req-filter ships without type declarations (only the default export is used)
 */
declare module 'ssrf-req-filter' {
  import type { Agent as HttpAgent } from 'http'
  import type { Agent as HttpsAgent } from 'https'

  /**
   * Returns an http or https agent (matching the url protocol) that blocks requests to private addresses
   */
  function ssrfFilter(url: string): HttpAgent | HttpsAgent
  export = ssrfFilter
}
