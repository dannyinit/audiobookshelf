import uaParserJs = require('../../libs/uaParser')

/**
 * @param {string|null|undefined} userAgent
 * @returns {{ browserName?:string, browserVersion?:string, osName?:string, osVersion?:string, deviceType?:string, model?:string, vendor?:string }|null}
 */
interface UserAgentDeviceInfo {
  browserName?: string
  browserVersion?: string
  osName?: string
  osVersion?: string
  deviceType?: string
  model?: string
  vendor?: string
}

function parseUserAgent(userAgent: string | null | undefined): UserAgentDeviceInfo | null {
  if (!userAgent) return null

  const ua = uaParserJs(userAgent)
  const deviceInfo: UserAgentDeviceInfo = {
    browserName: ua?.browser?.name || undefined,
    browserVersion: ua?.browser?.version || undefined,
    osName: ua?.os?.name || undefined,
    osVersion: ua?.os?.version || undefined,
    deviceType: ua?.device?.type || undefined,
    model: ua?.device?.model || undefined,
    vendor: ua?.device?.vendor || undefined
  }

  for (const key in deviceInfo) {
    if (deviceInfo[key as keyof UserAgentDeviceInfo] === undefined) delete deviceInfo[key as keyof UserAgentDeviceInfo]
  }

  return Object.keys(deviceInfo).length ? deviceInfo : null
}

export = parseUserAgent
