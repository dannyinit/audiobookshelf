import fsExtra = require('../../libs/fsExtra')
import type { FsExtra } from '../types'

// The inferred type of the vendored fs-extra lacks the fs methods it adds at runtime
const fs = fsExtra as unknown as FsExtra

function getPlaylistStr(segmentName: string, duration: number, segmentLength: number, hlsSegmentType: string): string {
  var ext = hlsSegmentType === 'fmp4' ? 'm4s' : 'ts'

  var lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-ALLOW-CACHE:NO',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD'
  ]
  if (hlsSegmentType === 'fmp4') {
    lines.push('#EXT-X-MAP:URI="init.mp4"')
  }
  var numSegments = Math.floor(duration / segmentLength)
  var lastSegment = duration - (numSegments * segmentLength)
  for (let i = 0; i < numSegments; i++) {
    lines.push(`#EXTINF:6,`)
    lines.push(`${segmentName}-${i}.${ext}`)
  }
  if (lastSegment > 0) {
    lines.push(`#EXTINF:${lastSegment},`)
    lines.push(`${segmentName}-${numSegments}.${ext}`)
  }
  lines.push('#EXT-X-ENDLIST')
  return lines.join('\n')
}

function generatePlaylist(outputPath: string, segmentName: string, duration: number, segmentLength: number, hlsSegmentType: string) {
  var playlistStr = getPlaylistStr(segmentName, duration, segmentLength, hlsSegmentType)
  return fs.writeFile(outputPath, playlistStr)
}
export = generatePlaylist