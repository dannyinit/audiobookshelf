import axios, { AxiosResponse } from 'axios'
import ssrfFilter from 'ssrf-req-filter'
import Ffmpeg = require('../libs/fluentFfmpeg')
import ffmpgegUtils = require('../libs/fluentFfmpeg/utils')
import fsExtra = require('../libs/fsExtra')
import Path = require('path')
import Logger = require('../Logger')
import fileUtils = require('./fileUtils')
import PodcastEpisodeDownload = require('../objects/PodcastEpisodeDownload')
const { filePathToPOSIX, copyToExisting } = fileUtils

const fs = fsExtra

/**
 * Audio track fields used (see models/Book AudioFileObject)
 */
interface ConcatAudioTrack {
  index: number
  duration: number
  metadata: {
    path: string
    ext: string
  }
}

interface FFMetadataChapter {
  start: number
  end: number
  title?: string
}

type FFMetadata = Record<string, string | null | undefined>

/**
 * Book fields used from libraryItem.media (see models/Book)
 */
interface FFMetadataLibraryItem {
  media: {
    title?: string | null
    authorName?: string | null
    subtitle?: string | null
    genres?: string[] | null
    publishedYear?: string | null
    description?: string | null
    narrators?: string[] | null
    publisher?: string | null
    series?: { name: string; bookSeries: { sequence?: string | null } }[] | null
  }
}

/**
 * See managers/AbMergeManager AbMergeEncodeOptions
 */
interface AbMergeEncodeOptions {
  bitrate?: string
  codec?: string
  channels?: number
}

function escapeSingleQuotes(path: string): string {
  // A ' within a quoted string is escaped with '\'' in ffmpeg (see https://www.ffmpeg.org/ffmpeg-utils.html#Quoting-and-escaping)
  return filePathToPOSIX(path).replace(/'/g, "'\\''")
}

// Returns first track start time
// startTime is for streams starting an encode part-way through an audiobook
async function writeConcatFile(tracks: ConcatAudioTrack[], outputPath: string, startTime = 0): Promise<number | null> {
  var trackToStartWithIndex = 0
  var firstTrackStartTime = 0

  // Find first track greater than startTime
  if (startTime > 0) {
    var currTrackEnd = 0
    var startingTrack = tracks.find((t) => {
      currTrackEnd += t.duration
      return startTime < currTrackEnd
    })
    if (startingTrack) {
      firstTrackStartTime = currTrackEnd - startingTrack.duration
      trackToStartWithIndex = startingTrack.index
    }
  }

  var tracksToInclude = tracks.filter((t) => t.index >= trackToStartWithIndex)
  var trackPaths = tracksToInclude.map((t) => {
    var line = "file '" + escapeSingleQuotes(t.metadata.path) + "'\n" + `duration ${t.duration}`
    return line
  })
  var inputstr = trackPaths.join('\n\n')

  try {
    await fs.writeFile(outputPath, inputstr)
    return firstTrackStartTime
  } catch (error) {
    Logger.error(`[ffmpegHelpers] Failed to write stream concat file at "${outputPath}"`, error)
    return null
  }
}

async function extractCoverArt(filepath: string, outputpath: string): Promise<string | false> {
  var dirname = Path.dirname(outputpath)
  await fs.ensureDir(dirname)

  return new Promise((resolve) => {
    var ffmpeg = Ffmpeg(filepath)
    ffmpeg.addOption(['-map 0:v:0', '-frames:v 1'])
    ffmpeg.output(outputpath)

    ffmpeg.on('start', (cmd) => {
      Logger.debug(`[FfmpegHelpers] Extract Cover Cmd: ${cmd}`)
    })
    ffmpeg.on('error', (err, stdout, stderr) => {
      Logger.error(`[FfmpegHelpers] Extract Cover Error ${err}`)
      resolve(false)
    })
    ffmpeg.on('end', () => {
      Logger.debug(`[FfmpegHelpers] Cover Art Extracted Successfully`)
      resolve(outputpath)
    })
    ffmpeg.run()
  })
}

//This should convert based on the output file extension as well
async function resizeImage(filePath: string, outputPath: string, width: number | null | undefined, height: number | null | undefined): Promise<string | false> {
  return new Promise((resolve) => {
    var ffmpeg = Ffmpeg(filePath)
    ffmpeg.addOption(['-vf', `scale=${width || -1}:${height || -1}`])
    ffmpeg.addOutput(outputPath)
    ffmpeg.on('start', (cmd) => {
      Logger.debug(`[FfmpegHelpers] Resize Image Cmd: ${cmd}`)
    })
    ffmpeg.on('error', (err, stdout, stderr) => {
      Logger.error(`[FfmpegHelpers] Resize Image Error ${err} ${stdout} ${stderr}`)
      resolve(false)
    })
    ffmpeg.on('end', () => {
      Logger.debug(`[FfmpegHelpers] Image resized Successfully`)
      resolve(outputPath)
    })
    ffmpeg.run()
  })
}

/**
 * Download podcast episode
 * Uses SSRF filter to prevent internal URLs
 */
const downloadPodcastEpisode = (podcastEpisodeDownload: PodcastEpisodeDownload): Promise<{ success: boolean; isRequestError?: boolean }> => {
  return new Promise(async (resolve) => {
    // Some podcasts fail due to user agent strings
    // See: https://github.com/advplyr/audiobookshelf/issues/3246 (requires iTMS user agent)
    // See: https://github.com/advplyr/audiobookshelf/issues/4401 (requires no iTMS user agent)
    const userAgents = ['audiobookshelf (+https://audiobookshelf.org; like iTMS)', 'audiobookshelf (+https://audiobookshelf.org)']

    let response: AxiosResponse | null = null
    let lastError: unknown = null

    for (const userAgent of userAgents) {
      try {
        // cast(d): setData sets url before the download is queued (5 reads below)
        response = await axios({
          url: podcastEpisodeDownload.url!,
          method: 'GET',
          responseType: 'stream',
          headers: {
            Accept: '*/*',
            'User-Agent': userAgent
          },
          timeout: global.PodcastDownloadTimeout,
          httpAgent: global.DisableSsrfRequestFilter?.(podcastEpisodeDownload.url!) ? null : ssrfFilter(podcastEpisodeDownload.url!),
          httpsAgent: global.DisableSsrfRequestFilter?.(podcastEpisodeDownload.url!) ? null : ssrfFilter(podcastEpisodeDownload.url!)
        })

        Logger.debug(`[ffmpegHelpers] Successfully connected with User-Agent: ${userAgent}`)
        break
      } catch (error) {
        lastError = error
        // axios rejects with an Error
        Logger.warn(`[ffmpegHelpers] Failed to download podcast episode with User-Agent "${userAgent}" for url "${podcastEpisodeDownload.url}"`, (error as Error).message)

        // If this is the last attempt, log the full error
        if (userAgent === userAgents[userAgents.length - 1]) {
          Logger.error(`[ffmpegHelpers] All User-Agent attempts failed for url "${podcastEpisodeDownload.url}"`, lastError)
        }
      }
    }

    if (!response) {
      return resolve({
        success: false,
        isRequestError: true
      })
    }

    const ffmpeg = Ffmpeg(response.data)
    ffmpeg.addOption('-loglevel debug') // Debug logs printed on error
    ffmpeg.outputOptions('-c:a', 'copy', '-map', '0:a', '-metadata', 'podcast=1')

    // Episodes are only downloaded for podcast library items
    const podcast = podcastEpisodeDownload.libraryItem.media as import('../models/Podcast')
    // cast(d): setData sets rssPodcastEpisode before the download is queued
    const podcastEpisode = podcastEpisodeDownload.rssPodcastEpisode!
    const finalSizeInBytes = Number(podcastEpisode.enclosure?.length || 0)

    const taggings: Record<string, string | number | null | undefined> = {
      album: podcast.title,
      'album-sort': podcast.title,
      artist: podcast.author,
      'artist-sort': podcast.author,
      comment: podcastEpisode.description,
      subtitle: podcastEpisode.subtitle,
      disc: podcastEpisode.season,
      genre: podcast.genres.length ? podcast.genres.join(';') : null,
      language: podcast.language,
      MVNM: podcast.title,
      MVIN: podcastEpisode.episode,
      track: podcastEpisode.episode,
      'series-part': podcastEpisode.episode,
      title: podcastEpisode.title,
      'title-sort': podcastEpisode.title,
      year: podcastEpisodeDownload.pubYear,
      date: podcastEpisode.pubDate,
      releasedate: podcastEpisode.pubDate,
      'itunes-id': podcast.itunesId,
      'podcast-type': podcast.podcastType,
      'episode-type': podcastEpisode.episodeType
    }

    for (const tag in taggings) {
      const tagValue = taggings[tag]
      if (tagValue) {
        // The year is a number: its length is undefined so the check is false, as in the JS
        const tagString = tagValue as string
        if (tagString.length > 10000) {
          Logger.warn(`[ffmpegHelpers] Episode download tag "${tag}" is too long (${tagString.length} characters) - trimming it down`)
          taggings[tag] = tagString.slice(0, 10000)
        }
        ffmpeg.addOption('-metadata', `${tag}=${taggings[tag]}`)
      }
    }

    ffmpeg.addOutput(podcastEpisodeDownload.targetPath)

    const stderrLines: string[] = []
    ffmpeg.on('stderr', (stderrLine: unknown) => {
      if (typeof stderrLine === 'string') {
        stderrLines.push(stderrLine)
      }
    })
    ffmpeg.on('start', (cmd: string) => {
      Logger.debug(`[FfmpegHelpers] downloadPodcastEpisode: Cmd: ${cmd}`)
    })
    ffmpeg.on('error', (err: Error) => {
      Logger.error(`[FfmpegHelpers] downloadPodcastEpisode: Error ${err}`)
      if (stderrLines.length) {
        Logger.error(`Full stderr dump for episode url "${podcastEpisodeDownload.url}": ${stderrLines.join('\n')}`)
      }
      resolve({
        success: false
      })
    })
    ffmpeg.on('progress', (progress: { targetSize?: number }) => {
      let progressPercent = 0
      if (finalSizeInBytes && progress.targetSize && !isNaN(progress.targetSize)) {
        const finalSizeInKb = Math.floor(finalSizeInBytes / 1000)
        progressPercent = Math.min(1, progress.targetSize / finalSizeInKb) * 100
      }
      Logger.debug(`[FfmpegHelpers] downloadPodcastEpisode: Progress estimate ${progressPercent.toFixed(0)}% (${progress?.targetSize || 'N/A'} KB) for "${podcastEpisodeDownload.url}"`)
    })
    ffmpeg.on('end', () => {
      Logger.debug(`[FfmpegHelpers] downloadPodcastEpisode: Complete`)
      resolve({
        success: true
      })
    })
    ffmpeg.run()
  })
}

/**
 * Generates ffmetadata file content from the provided metadata object and chapters array.
 * @param metadata - The input metadata object.
 * @param chapters - An array of chapter objects.
 * @returns - The ffmetadata file content.
 */
function generateFFMetadata(metadata: FFMetadata, chapters: FFMetadataChapter[] | null): string {
  let ffmetadataContent = ';FFMETADATA1\n'

  // Add global metadata
  for (const key in metadata) {
    const value = metadata[key]
    if (value) {
      ffmetadataContent += `${key}=${escapeFFMetadataValue(value)}\n`
    }
  }

  // Add chapters
  if (chapters) {
    chapters.forEach((chapter) => {
      ffmetadataContent += '\n[CHAPTER]\n'
      ffmetadataContent += `TIMEBASE=1/1000\n`
      ffmetadataContent += `START=${Math.floor(chapter.start * 1000)}\n`
      ffmetadataContent += `END=${Math.floor(chapter.end * 1000)}\n`
      if (chapter.title) {
        ffmetadataContent += `title=${escapeFFMetadataValue(chapter.title)}\n`
      }
    })
  }

  return ffmetadataContent
}

/**
 * Writes FFmpeg metadata file with the given metadata and chapters.
 *
 * @param metadata - The metadata object.
 * @param chapters - The array of chapter objects.
 * @param ffmetadataPath - The path to the FFmpeg metadata file.
 * @returns - A promise that resolves to true if the file was written successfully, false otherwise.
 */
async function writeFFMetadataFile(metadata: FFMetadata, chapters: FFMetadataChapter[] | null, ffmetadataPath: string): Promise<boolean> {
  try {
    await fs.writeFile(ffmetadataPath, generateFFMetadata(metadata, chapters))
    Logger.debug(`[ffmpegHelpers] Wrote ${ffmetadataPath}`)
    return true
  } catch (error) {
    Logger.error(`[ffmpegHelpers] Write ${ffmetadataPath} failed`, error)
    return false
  }
}

/**
 * Adds an ffmetadata and optionally a cover image to an audio file using fluent-ffmpeg.
 *
 * @param audioFilePath - Path to the input audio file.
 * @param coverFilePath - Path to the cover image file.
 * @param metadataFilePath - Path to the ffmetadata file.
 * @param track - The track number to embed in the audio file.
 * @param mimeType - The MIME type of the audio file.
 * @param progressCB - A callback function to report progress.
 * @param ffmpeg - The Ffmpeg instance to use (optional). Used for dependency injection in tests.
 * @param copyFunc - The function to use for copying files (optional). Used for dependency injection in tests.
 * @returns A promise that resolves if the operation is successful, rejects otherwise.
 */
async function addCoverAndMetadataToFile(
  audioFilePath: string,
  coverFilePath: string | null,
  metadataFilePath: string,
  track: number,
  /** null when the files of a book have different mime types (see AudioMetadataManager); only compared below */
  mimeType: string | null,
  progressCB: ((percent: number) => void) | null = null,
  ffmpeg: Ffmpeg.FfmpegCommand = Ffmpeg(),
  copyFunc: (srcPath: string, destPath: string) => Promise<void> = copyToExisting
): Promise<void> {
  const isMp4 = mimeType === 'audio/mp4'
  const isMp3 = mimeType === 'audio/mpeg'

  const audioFileDir = Path.dirname(audioFilePath)
  const audioFileExt = Path.extname(audioFilePath)
  const audioFileBaseName = Path.basename(audioFilePath, audioFileExt)
  const tempFilePath = filePathToPOSIX(Path.join(audioFileDir, `${audioFileBaseName}.tmp${audioFileExt}`))

  return new Promise((resolve, reject) => {
    ffmpeg.input(audioFilePath).input(metadataFilePath).outputOptions([
      '-map 0:a', // map audio stream from input file
      '-map_metadata 1', // map metadata tags from metadata file first
      '-map_metadata 0', // add additional metadata tags from input file
      '-map_chapters 1', // map chapters from metadata file
      '-c copy' // copy streams
    ])

    if (track && !isNaN(track)) {
      ffmpeg.outputOptions(['-metadata track=' + track])
    }

    if (isMp4) {
      ffmpeg.outputOptions([
        '-f mp4' // force output format to mp4
      ])
    } else if (isMp3) {
      ffmpeg.outputOptions([
        '-id3v2_version 3' // set ID3v2 version to 3
      ])
    }

    if (coverFilePath) {
      ffmpeg.input(coverFilePath).outputOptions([
        '-map 2:v', // map video stream from cover image file
        '-disposition:v:0 attached_pic', // set cover image as attached picture
        '-metadata:s:v',
        'title=Cover', // add title metadata to cover image stream
        '-metadata:s:v',
        'comment=Cover' // add comment metadata to cover image stream
      ])
      const ext = Path.extname(coverFilePath).toLowerCase()
      if (ext === '.webp') {
        ffmpeg.outputOptions([
          '-c:v mjpeg' // convert webp images to jpeg
        ])
      }
    } else {
      ffmpeg.outputOptions([
        '-map 0:v?' // retain video stream from input file if exists
      ])
    }

    ffmpeg
      .output(tempFilePath)
      .on('start', (commandLine: string) => {
        Logger.debug('[ffmpegHelpers] Spawned Ffmpeg with command: ' + commandLine)
      })
      .on('progress', (progress: { percent?: number }) => {
        if (!progressCB || !progress.percent) return
        Logger.debug(`[ffmpegHelpers] Progress: ${progress.percent}%`)
        progressCB(progress.percent)
      })
      .on('end', async (stdout: string | string[] | null, stderr: string | null) => {
        Logger.debug('[ffmpegHelpers] ffmpeg stdout:', stdout)
        Logger.debug('[ffmpegHelpers] ffmpeg stderr:', stderr)
        Logger.debug('[ffmpegHelpers] Moving temp file to audio file path:', `"${tempFilePath}"`, '->', `"${audioFilePath}"`)
        try {
          await copyFunc(tempFilePath, audioFilePath)
          await fs.remove(tempFilePath)
          resolve()
        } catch (error) {
          Logger.error(`[ffmpegHelpers] Failed to move temp file to audio file path: "${tempFilePath}" -> "${audioFilePath}"`, error)
          reject(error)
        }
      })
      .on('error', (err: Error, stdout: string | null, stderr: string | null) => {
        if (err.message && err.message.includes('SIGKILL')) {
          Logger.info(`[ffmpegHelpers] addCoverAndMetadataToFile Killed by User`)
          reject(new Error('FFMPEG_CANCELED'))
        } else {
          Logger.error('Error adding cover image and metadata:', err)
          Logger.error('ffmpeg stdout:', stdout)
          Logger.error('ffmpeg stderr:', stderr)
          reject(err)
        }
      })

    ffmpeg.run()
  })
}

function escapeFFMetadataValue(value: string): string {
  return value.replace(/([;=\n\\#])/g, '\\$1')
}

/**
 * Retrieves the FFmpeg metadata object for a given library item.
 *
 * @param libraryItem - The library item containing the media metadata.
 * @param audioFilesLength - The length of the audio files.
 * @returns - The FFmpeg metadata object.
 */
function getFFMetadataObject(libraryItem: FFMetadataLibraryItem, audioFilesLength: number): FFMetadata {
  const ffmetadata: FFMetadata = {
    title: libraryItem.media.title,
    artist: libraryItem.media.authorName,
    album_artist: libraryItem.media.authorName,
    album: (libraryItem.media.title || '') + (libraryItem.media.subtitle ? `: ${libraryItem.media.subtitle}` : ''),
    TIT3: libraryItem.media.subtitle, // mp3 only
    genre: libraryItem.media.genres?.join('; '),
    date: libraryItem.media.publishedYear,
    comment: libraryItem.media.description,
    description: libraryItem.media.description,
    composer: (libraryItem.media.narrators || []).join(', '),
    copyright: libraryItem.media.publisher,
    publisher: libraryItem.media.publisher, // mp3 only
    TRACKTOTAL: `${audioFilesLength}`, // mp3 only
    grouping: libraryItem.media.series?.map((s) => s.name + (s.bookSeries.sequence ? ` #${s.bookSeries.sequence}` : '')).join('; ')
  }
  Object.keys(ffmetadata).forEach((key) => {
    if (!ffmetadata[key]) {
      delete ffmetadata[key]
    }
  })

  return ffmetadata
}

/**
 * Merges audio files into a single output file using FFmpeg.
 *
 * @param audioTracks - The audio tracks to merge.
 * @param duration - The total duration of the audio tracks.
 * @param itemCachePath - The path to the item cache.
 * @param outputFilePath - The path to the output file.
 * @param encodingOptions - The options for encoding the audio.
 * @param [progressCB=null] - The callback function to track the progress of the merge.
 * @param [ffmpeg=Ffmpeg()] - The FFmpeg instance to use for merging.
 * @returns A promise that resolves when the audio files are merged successfully.
 */
async function mergeAudioFiles(
  audioTracks: ConcatAudioTrack[],
  duration: number,
  itemCachePath: string,
  outputFilePath: string,
  encodingOptions: AbMergeEncodeOptions,
  progressCB: ((percent: number) => void) | null = null,
  ffmpeg: Ffmpeg.FfmpegCommand = Ffmpeg()
): Promise<void> {
  const audioBitrate = encodingOptions.bitrate || '128k'
  const audioCodec = encodingOptions.codec || 'aac'
  const audioChannels = encodingOptions.channels || 2

  // TODO: Updated in 2.2.11 to always encode even if merging multiple m4b. This is because just using the file extension as was being done before is not enough. This can be an option or do more to check if a concat is possible.
  // const audioRequiresEncode = audioTracks[0].metadata.ext !== '.m4b'
  const audioRequiresEncode = true

  const firstTrackIsM4b = audioTracks[0].metadata.ext.toLowerCase() === '.m4b'
  const isOneTrack = audioTracks.length === 1

  let concatFilePath: string | null = null
  if (!isOneTrack) {
    concatFilePath = Path.join(itemCachePath, 'files.txt')
    if ((await writeConcatFile(audioTracks, concatFilePath)) == null) {
      throw new Error('Failed to write concat file')
    }
    ffmpeg.input(concatFilePath).inputOptions(['-safe 0', '-f concat'])
  } else {
    ffmpeg.input(audioTracks[0].metadata.path).inputOptions(firstTrackIsM4b ? ['-f mp4'] : [])
  }

  //const logLevel = process.env.NODE_ENV === 'production' ? 'error' : 'warning'
  ffmpeg.outputOptions(['-f mp4'])

  if (audioRequiresEncode) {
    ffmpeg.outputOptions(['-map 0:a', `-acodec ${audioCodec}`, `-ac ${audioChannels}`, `-b:a ${audioBitrate}`])
  } else {
    ffmpeg.outputOptions(['-max_muxing_queue_size 1000'])

    if (isOneTrack && firstTrackIsM4b) {
      ffmpeg.outputOptions(['-c copy'])
    } else {
      ffmpeg.outputOptions(['-c:a copy'])
    }
  }

  ffmpeg.output(outputFilePath)

  return new Promise((resolve, reject) => {
    ffmpeg
      .on('start', (cmd: string) => {
        Logger.debug(`[ffmpegHelpers] Merge Audio Files ffmpeg command: ${cmd}`)
      })
      .on('progress', (progress: { timemark?: string }) => {
        if (!progressCB || !progress.timemark || !duration) return
        // Cannot rely on progress.percent as it is not accurate for concat
        const percent = (ffmpgegUtils.timemarkToSeconds(progress.timemark) / duration) * 100
        progressCB(percent)
      })
      .on('end', async (stdout: string | string[] | null, stderr: string | null) => {
        if (concatFilePath) await fs.remove(concatFilePath)
        Logger.debug('[ffmpegHelpers] ffmpeg stdout:', stdout)
        Logger.debug('[ffmpegHelpers] ffmpeg stderr:', stderr)
        Logger.debug(`[ffmpegHelpers] Audio Files Merged Successfully`)
        resolve()
      })
      .on('error', async (err: Error, stdout: string | null, stderr: string | null) => {
        if (concatFilePath) await fs.remove(concatFilePath)
        if (err.message && err.message.includes('SIGKILL')) {
          Logger.info(`[ffmpegHelpers] Merge Audio Files Killed by User`)
          reject(new Error('FFMPEG_CANCELED'))
        } else {
          Logger.error(`[ffmpegHelpers] Merge Audio Files Error ${err}`)
          Logger.error('ffmpeg stdout:', stdout)
          Logger.error('ffmpeg stderr:', stderr)
          reject(err)
        }
      })

    ffmpeg.run()
  })
}

export = {
  writeConcatFile,
  extractCoverArt,
  resizeImage,
  downloadPodcastEpisode,
  generateFFMetadata,
  writeFFMetadataFile,
  addCoverAndMetadataToFile,
  getFFMetadataObject,
  mergeAudioFiles
}
