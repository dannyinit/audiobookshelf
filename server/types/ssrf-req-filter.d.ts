declare module 'ssrf-req-filter' {
  import type { Agent as HttpAgent } from 'http'
  import type { Agent as HttpsAgent } from 'https'

  /** Returns an http(s) agent for the url that refuses connections to private/internal addresses */
  function ssrfFilter(url: string): HttpAgent | HttpsAgent

  export = ssrfFilter
}
