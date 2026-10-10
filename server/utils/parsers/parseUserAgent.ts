import uaParserJs = require('../../libs/uaParser')

interface DeviceInfo {
  browserName?: string
  browserVersion?: string
  osName?: string
  osVersion?: string
  deviceType?: string
  model?: string
  vendor?: string
}

function parseUserAgent(userAgent: string | null | undefined): DeviceInfo | null {
  if (!userAgent) return null

  const ua = uaParserJs(userAgent)
  const deviceInfo: DeviceInfo = {
    browserName: ua?.browser?.name || undefined,
    browserVersion: ua?.browser?.version || undefined,
    osName: ua?.os?.name || undefined,
    osVersion: ua?.os?.version || undefined,
    deviceType: ua?.device?.type || undefined,
    model: ua?.device?.model || undefined,
    vendor: ua?.device?.vendor || undefined
  }

  for (const key in deviceInfo) {
    // cast(d) (2): for...in only yields keys of deviceInfo
    if (deviceInfo[key as keyof DeviceInfo] === undefined) delete deviceInfo[key as keyof DeviceInfo]
  }

  return Object.keys(deviceInfo).length ? deviceInfo : null
}

export = parseUserAgent
