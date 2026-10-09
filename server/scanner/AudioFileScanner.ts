import Path = require('path')
import Logger = require('../Logger')
import prober = require('../utils/prober')
import constants = require('../utils/constants')
import parseOverdriveMediaMarkers = require('../utils/parsers/parseOverdriveMediaMarkers')
import parseNameString = require('../utils/parsers/parseNameString')
import parseSeriesString = require('../utils/parsers/parseSeriesString')
// Only used as a type; required for its side effects so the module load order stays as in the JS
import '../models/LibraryItem'
import type LibraryItem = require('../models/LibraryItem')
import AudioFile = require('../objects/files/AudioFile')
import type LibraryFile = require('../objects/files/LibraryFile')
import type MediaProbeData = require('./MediaProbeData')
import type LibraryScan = require('./LibraryScan')
import type ScanLogger = require('./ScanLogger')
import type LibraryItemScanData = require('./LibraryItemScanData')
import type { AudioFileObject, ChapterObject, LibraryFileObject } from '../models/types'
import type { BookMetadataObject, PodcastMetadataObject } from './types'
import type AudioMetaTags = require('../objects/metadata/AudioMetaTags')
const { LogLevel } = constants

/**
 * Meta tag name (AudioMetaTags field)
 */
type MetaTagKey = keyof ReturnType<AudioMetaTags['toJSON']>

/**
 * Meta tag to read and the metadata key it maps to
 */
interface MetaTagMapping {
  tag: MetaTagKey
  altTag?: MetaTagKey
  key: string
}
const { parseOverdriveMediaMarkersAsChapters } = parseOverdriveMediaMarkers

/**
 * Audio file of a book or podcast episode: a scanned AudioFile, its JSON (AudioFile toJSON) or the stored JSON
 */
type ScannedOrStoredAudioFile = AudioFile | ReturnType<AudioFile['toJSON']> | AudioFileObject

/**
 * Library file to scan: a scanned LibraryFile or the stored JSON (modified files)
 */
type ScannedOrStoredLibraryFile = LibraryFile | LibraryFileObject

/**
 * The fields smart track order reads and sets
 */
interface OrderableAudioFile {
  discNumFromFilename: number | null
  discNumFromMeta: number | null
  trackNumFromFilename: number | null
  trackNumFromMeta: number | null
  index: number | null
}

/**
 * Library item metadata parsed from the folder and file names (see LibraryItemScanData)
 */
type MediaMetadataFromScan = LibraryItemScanData['mediaMetadata']

/**
 * Podcast episode whose metadata is set from its audio file meta tags (the model, or the plain episode object of a new podcast)
 */
interface PodcastEpisodeWithAudioFile {
  title: string | null
  subtitle: string | null
  description: string | null
  pubDate: string | null
  season: string | null
  episode: string | null
  episodeType: string | null
  publishedAt: Date | number | null
  audioFile: ScannedOrStoredAudioFile
}

class AudioFileScanner {
  constructor() {}

  /**
   * Is array of numbers sequential, i.e. 1, 2, 3, 4
   */
  isSequential(nums: number[]): boolean {
    if (!nums?.length) return false
    if (nums.length === 1) return true
    let prev = nums[0]
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] - prev > 1) return false
      prev = nums[i]
    }
    return true
  }

  /**
   * Remove
   */
  removeDupes(nums: number[]): number[] {
    if (!nums || !nums.length) return []
    if (nums.length === 1) return nums

    let nodupes = [nums[0]]
    nums.forEach((num) => {
      if (num > nodupes[nodupes.length - 1]) nodupes.push(num)
    })
    return nodupes
  }

  /**
   * Order audio files by track/disc number
   */
  runSmartTrackOrder<T extends OrderableAudioFile>(libraryItemRelPath: string, audioFiles: T[]): T[] {
    if (!audioFiles.length) return []

    let discsFromFilename: number[] = []
    let tracksFromFilename: number[] = []
    let discsFromMeta: number[] = []
    let tracksFromMeta: number[] = []

    audioFiles.forEach((af) => {
      if (af.discNumFromFilename !== null) discsFromFilename.push(af.discNumFromFilename)
      if (af.discNumFromMeta !== null) discsFromMeta.push(af.discNumFromMeta)
      if (af.trackNumFromFilename !== null) tracksFromFilename.push(af.trackNumFromFilename)
      if (af.trackNumFromMeta !== null) tracksFromMeta.push(af.trackNumFromMeta)
    })
    discsFromFilename.sort((a, b) => a - b)
    discsFromMeta.sort((a, b) => a - b)
    tracksFromFilename.sort((a, b) => a - b)
    tracksFromMeta.sort((a, b) => a - b)

    let discKey: 'discNumFromMeta' | 'discNumFromFilename' | null = null
    if (discsFromMeta.length === audioFiles.length && this.isSequential(discsFromMeta)) {
      discKey = 'discNumFromMeta'
    } else if (discsFromFilename.length === audioFiles.length && this.isSequential(discsFromFilename)) {
      discKey = 'discNumFromFilename'
    }

    let trackKey: 'trackNumFromFilename' | 'trackNumFromMeta' | null = null
    tracksFromFilename = this.removeDupes(tracksFromFilename)
    tracksFromMeta = this.removeDupes(tracksFromMeta)
    if (tracksFromFilename.length > tracksFromMeta.length) {
      trackKey = 'trackNumFromFilename'
    } else {
      trackKey = 'trackNumFromMeta'
    }

    if (discKey !== null) {
      Logger.debug(`[AudioFileScanner] Smart track order for "${libraryItemRelPath}" using disc key ${discKey} and track key ${trackKey}`)
      audioFiles.sort((a, b) => {
        // An audio file without a disc or track number (null) sorts as 0 (only files with numbers are counted above)
        // The disc and track keys were set above
        let Dx = a[discKey!]! - b[discKey!]!
        if (Dx === 0) Dx = a[trackKey!]! - b[trackKey!]!
        return Dx
      })
    } else {
      Logger.debug(`[AudioFileScanner] Smart track order for "${libraryItemRelPath}" using track key ${trackKey}`)
      // The track key was set above; a file without a track number (null) sorts as 0
      audioFiles.sort((a, b) => a[trackKey!]! - b[trackKey!]!)
    }

    for (let i = 0; i < audioFiles.length; i++) {
      audioFiles[i].index = i + 1
    }
    return audioFiles
  }

  /**
   * Get track and disc number from audio filename
   */
  getTrackAndDiscNumberFromFilename(mediaMetadataFromScan: MediaMetadataFromScan, audioLibraryFile: ScannedOrStoredLibraryFile): { trackNumber: number | null; discNumber: number | null } {
    // NOTE: the filename metadata has authors and seriesName, not author and series, so those two are always undefined and never removed from the filename
    // cast(c): read as in the JS (see NOTE above)
    const { title, author, series, publishedYear } = mediaMetadataFromScan as MediaMetadataFromScan & { author?: string; series?: string }
    // setDataFromPath sets the filename and path of scanned files
    const { filename, path } = audioLibraryFile.metadata as { filename: string; path: string }
    let partbasename = Path.basename(filename, Path.extname(filename))

    // Remove title, author, series, and publishedYear from filename if there
    if (title) partbasename = partbasename.replace(title, '')
    if (author) partbasename = partbasename.replace(author, '')
    if (series) partbasename = partbasename.replace(series, '')
    // NOTE: replace without a replacement replaces the year with the string "undefined"
    // cast(c): called as in the JS (see NOTE above)
    if (publishedYear) partbasename = (partbasename as string & { replace(searchValue: string): string }).replace(publishedYear)

    // Look for disc number
    let discNumber = null
    const discMatch = partbasename.match(/\b(disc|cd) ?(\d\d?)\b/i)
    if (discMatch && discMatch.length > 2 && discMatch[2]) {
      // cast(d): isNaN coerces the matched digits, as in the JS
      if (!isNaN(discMatch[2] as unknown as number)) {
        discNumber = Number(discMatch[2])
      }

      // Remove disc number from filename
      partbasename = partbasename.replace(/\b(disc|cd) ?(\d\d?)\b/i, '')
    }

    // Look for disc number in folder path e.g. /Book Title/CD01/audiofile.mp3
    const pathdir = Path.dirname(path).split('/').pop()
    if (pathdir && /^(cd|dis[ck])\s*\d{1,3}$/i.test(pathdir)) {
      const discFromFolder = Number(pathdir.replace(/^(cd|dis[ck])\s*/i, ''))
      if (!isNaN(discFromFolder) && discFromFolder !== null) discNumber = discFromFolder
    }

    const numbersinpath = partbasename.match(/\d{1,4}/g)
    const trackNumber = numbersinpath && numbersinpath.length ? parseInt(numbersinpath[0]) : null
    return {
      trackNumber,
      discNumber
    }
  }

  async scan(mediaType: string, libraryFile: ScannedOrStoredLibraryFile, mediaMetadataFromScan: MediaMetadataFromScan): Promise<AudioFile | null> {
    // cast(d): an error result only has error, which is checked first; the other reads come after that check
    // setDataFromPath sets the path of scanned files
    const probeData = (await prober.probe(libraryFile.metadata.path!)) as MediaProbeData

    if (probeData.error) {
      Logger.error(`[AudioFileScanner] ${probeData.error} : "${libraryFile.metadata.path}"`)
      return null
    }

    if (!probeData.audioStream) {
      Logger.error('[AudioFileScanner] Invalid audio file no audio stream')
      return null
    }

    const audioFile = new AudioFile()
    // setData sets the audio meta tags of probe data
    audioFile.trackNumFromMeta = probeData.audioMetaTags!.trackNumber
    audioFile.discNumFromMeta = probeData.audioMetaTags!.discNumber
    if (mediaType === 'book') {
      const { trackNumber, discNumber } = this.getTrackAndDiscNumberFromFilename(mediaMetadataFromScan, libraryFile)
      audioFile.trackNumFromFilename = trackNumber
      audioFile.discNumFromFilename = discNumber
    }
    audioFile.setDataFromProbe(libraryFile, probeData)

    return audioFile
  }

  /**
   * Scan LibraryFiles and return AudioFiles
   */
  async executeMediaFileScans(mediaType: string, libraryItemScanData: LibraryItemScanData, audioLibraryFiles: ScannedOrStoredLibraryFile[]): Promise<AudioFile[]> {
    const batchSize = 32
    const results: AudioFile[] = []
    for (let batch = 0; batch < audioLibraryFiles.length; batch += batchSize) {
      const proms: Promise<AudioFile | null>[] = []
      for (let i = batch; i < Math.min(batch + batchSize, audioLibraryFiles.length); i++) {
        proms.push(this.scan(mediaType, audioLibraryFiles[i], libraryItemScanData.mediaMetadata))
      }
      // cast(d): the failed scans (null) are filtered out
      results.push(...(await Promise.all(proms).then((scanResults) => scanResults.filter((sr) => sr) as AudioFile[])))
    }

    return results
  }

  probeAudioFile(audioFilePath: string) {
    Logger.debug(`[AudioFileScanner] Running ffprobe for audio file at "${audioFilePath}"`)
    return prober.rawProbe(audioFilePath)
  }

  /**
   * Set book metadata & chapters from audio file meta tags
   */
  setBookMetadataFromAudioMetaTags(bookTitle: string, audioFiles: ScannedOrStoredAudioFile[], bookMetadata: BookMetadataObject, libraryScan: LibraryScan | ScanLogger) {
    const MetadataMapArray: MetaTagMapping[] = [
      {
        tag: 'tagComposer',
        key: 'narrators'
      },
      {
        tag: 'tagDescription',
        altTag: 'tagComment',
        key: 'description'
      },
      {
        tag: 'tagPublisher',
        key: 'publisher'
      },
      {
        tag: 'tagDate',
        key: 'publishedYear'
      },
      {
        tag: 'tagSubtitle',
        key: 'subtitle'
      },
      {
        tag: 'tagAlbum',
        altTag: 'tagTitle',
        key: 'title'
      },
      {
        tag: 'tagArtist',
        altTag: 'tagAlbumArtist',
        key: 'authors'
      },
      {
        tag: 'tagGenre',
        key: 'genres'
      },
      {
        tag: 'tagSeries',
        altTag: 'tagGrouping',
        key: 'series'
      },
      {
        tag: 'tagIsbn',
        key: 'isbn'
      },
      {
        tag: 'tagLanguage',
        key: 'language'
      },
      {
        tag: 'tagASIN',
        key: 'asin'
      }
    ]

    const firstScannedFile = audioFiles[0]
    const audioFileMetaTags = firstScannedFile.metaTags
    MetadataMapArray.forEach((mapping) => {
      let value = audioFileMetaTags[mapping.tag]
      let isAltTag = false
      if (!value && mapping.altTag) {
        value = audioFileMetaTags[mapping.altTag]
        isAltTag = true
      }

      if (value && typeof value === 'string') {
        value = value.trim() // Trim whitespace

        if (mapping.key === 'narrators') {
          // cast(d): the name parser types its names as possibly undefined; they are the parsed strings
          bookMetadata.narrators = (parseNameString.parse(value)?.names || []) as string[]
        } else if (mapping.key === 'authors') {
          // cast(d): the name parser types its names as possibly undefined; they are the parsed strings
          bookMetadata.authors = (parseNameString.parse(value)?.names || []) as string[]
        } else if (mapping.key === 'genres') {
          bookMetadata.genres = this.parseGenresString(value)
        } else if (mapping.key === 'series') {
          // If series was embedded in the grouping tag, then parse it with semicolon separator and sequence in the same string
          // e.g. "Test Series; Series Name #1; Other Series #2"
          if (isAltTag) {
            const series = value
              .split(';')
              .map((seriesWithPart) => {
                seriesWithPart = seriesWithPart.trim()
                return parseSeriesString.parse(seriesWithPart)
              })
              .filter(Boolean)
            if (series.length) {
              // cast(d): the series that did not parse (null) are filtered out
              bookMetadata.series = series as BookMetadataObject['series']
            }
          } else {
            // Detect if multiple series are in the series & series-part tags.
            // Note: This requires that every series has a sequence and that they are separated by a semicolon.
            if (value.includes(';') && audioFileMetaTags.tagSeriesPart?.includes(';')) {
              const seriesSplit = value
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean)
              const seriesSequenceSplit = audioFileMetaTags.tagSeriesPart
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean)
              if (seriesSplit.length > 1 && seriesSplit.length === seriesSequenceSplit.length) {
                bookMetadata.series = seriesSplit.map((series, index) => ({
                  name: series,
                  sequence: seriesSequenceSplit[index] || null
                }))
                libraryScan.addLog(LogLevel.DEBUG, `Detected multiple series in series/series-part tags: ${bookMetadata.series.map((s) => `${s.name} #${s.sequence}`).join(', ')}`)
                return
              }
            }

            // Original embed used "series" and "series-part" tags
            bookMetadata.series = [
              {
                name: value,
                sequence: audioFileMetaTags.tagSeriesPart || null
              }
            ]
          }
        } else {
          // cast(d): dynamic metadata key
          (bookMetadata as Record<string, unknown>)[mapping.key] = value
        }
      }
    })

    // Set chapters
    const chapters = this.getBookChaptersFromAudioFiles(bookTitle, audioFiles, libraryScan)
    if (chapters.length) {
      bookMetadata.chapters = chapters
    }
  }

  /**
   * Set podcast metadata from first audio file
   */
  setPodcastMetadataFromAudioMetaTags(audioFile: ScannedOrStoredAudioFile, podcastMetadata: PodcastMetadataObject, libraryScan: LibraryScan | ScanLogger) {
    const audioFileMetaTags = audioFile.metaTags

    const MetadataMapArray: MetaTagMapping[] = [
      {
        tag: 'tagAlbum',
        altTag: 'tagSeries',
        key: 'title'
      },
      {
        tag: 'tagAlbumArtist',
        altTag: 'tagArtist',
        key: 'author'
      },
      {
        tag: 'tagGenre',
        key: 'genres'
      },
      {
        tag: 'tagLanguage',
        key: 'language'
      },
      {
        tag: 'tagItunesId',
        key: 'itunesId'
      },
      {
        tag: 'tagPodcastType',
        key: 'podcastType'
      }
    ]

    MetadataMapArray.forEach((mapping) => {
      let value = audioFileMetaTags[mapping.tag]
      let tagToUse = mapping.tag
      if (!value && mapping.altTag) {
        value = audioFileMetaTags[mapping.altTag]
        tagToUse = mapping.altTag
      }

      if (value && typeof value === 'string') {
        value = value.trim() // Trim whitespace

        if (mapping.key === 'genres') {
          podcastMetadata.genres = this.parseGenresString(value)
          libraryScan.addLog(LogLevel.DEBUG, `Mapping metadata to key ${tagToUse} => ${mapping.key}: ${podcastMetadata.genres.join(', ')}`)
        } else {
          // cast(d): dynamic metadata key
          (podcastMetadata as Record<string, unknown>)[mapping.key] = value
          // cast(d): dynamic metadata key
          libraryScan.addLog(LogLevel.DEBUG, `Mapping metadata to key ${tagToUse} => ${mapping.key}: ${(podcastMetadata as Record<string, unknown>)[mapping.key]}`)
        }
      }
    })
  }

  /**
   * @param podcastEpisode Not the model when creating new podcast
   */
  setPodcastEpisodeMetadataFromAudioMetaTags(podcastEpisode: PodcastEpisodeWithAudioFile, scanLogger: LibraryScan | ScanLogger) {
    const MetadataMapArray: MetaTagMapping[] = [
      {
        tag: 'tagComment',
        altTag: 'tagDescription',
        key: 'description'
      },
      {
        tag: 'tagSubtitle',
        key: 'subtitle'
      },
      {
        tag: 'tagDate',
        key: 'pubDate'
      },
      {
        tag: 'tagDisc',
        key: 'season'
      },
      {
        tag: 'tagTrack',
        altTag: 'tagSeriesPart',
        key: 'episode'
      },
      {
        tag: 'tagTitle',
        key: 'title'
      },
      {
        tag: 'tagEpisodeType',
        key: 'episodeType'
      }
    ]

    const audioFileMetaTags = podcastEpisode.audioFile.metaTags
    MetadataMapArray.forEach((mapping) => {
      let value = audioFileMetaTags[mapping.tag]
      let tagToUse = mapping.tag
      if (!value && mapping.altTag) {
        tagToUse = mapping.altTag
        value = audioFileMetaTags[mapping.altTag]
      }

      if (value && typeof value === 'string') {
        value = value.trim() // Trim whitespace

        if (mapping.key === 'pubDate') {
          const pubJsDate = new Date(value)
          // cast(d): isNaN coerces the Date to its time value, as in the JS
          if (pubJsDate && !isNaN(pubJsDate as unknown as number)) {
            podcastEpisode.publishedAt = pubJsDate.valueOf()
            podcastEpisode.pubDate = value
            // cast(d): dynamic metadata key
            scanLogger.addLog(LogLevel.DEBUG, `Mapping metadata to key ${tagToUse} => ${mapping.key}: ${(podcastEpisode as unknown as Record<string, unknown>)[mapping.key]}`)
          } else {
            scanLogger.addLog(LogLevel.WARN, `Mapping pubDate with tag ${tagToUse} has invalid date "${value}"`)
          }
        } else if (mapping.key === 'episodeType') {
          if (['full', 'trailer', 'bonus'].includes(value)) {
            podcastEpisode.episodeType = value
            // cast(d): dynamic metadata key
            scanLogger.addLog(LogLevel.DEBUG, `Mapping metadata to key ${tagToUse} => ${mapping.key}: ${(podcastEpisode as unknown as Record<string, unknown>)[mapping.key]}`)
          } else {
            scanLogger.addLog(LogLevel.WARN, `Mapping episodeType with invalid value "${value}". Must be one of [full, trailer, bonus].`)
          }
        } else {
          // cast(d): dynamic metadata key (description, subtitle, season, episode, title: string columns)
          (podcastEpisode as unknown as Record<string, unknown>)[mapping.key] = value
          // cast(d): dynamic metadata key
          scanLogger.addLog(LogLevel.DEBUG, `Mapping metadata to key ${tagToUse} => ${mapping.key}: ${(podcastEpisode as unknown as Record<string, unknown>)[mapping.key]}`)
        }
      }
    })
  }

  getBookChaptersFromAudioFiles(bookTitle: string, audioFiles: ScannedOrStoredAudioFile[], libraryScan: LibraryScan | ScanLogger): ChapterObject[] {
    // If overdrive media markers are present then use those instead
    // cast(d): scanned and stored audio files have a duration
    const overdriveChapters = parseOverdriveMediaMarkersAsChapters(audioFiles as Parameters<typeof parseOverdriveMediaMarkersAsChapters>[0])
    if (overdriveChapters?.length) {
      libraryScan.addLog(LogLevel.DEBUG, 'Overdrive Media Markers and preference found! Using these for chapter definitions')

      // cast(d): addChapterEndTimes sets the end of every chapter
      return overdriveChapters as ChapterObject[]
    }

    let chapters: ChapterObject[] = []

    // If first audio file has embedded chapters then use embedded chapters
    if (audioFiles[0].chapters?.length) {
      // If all files chapters are the same, then only make chapters for the first file
      if (audioFiles.length === 1 || (audioFiles.length > 1 && audioFiles[0].chapters.length === audioFiles[1].chapters?.length && audioFiles[0].chapters.every((c, i) => c.title === audioFiles[1].chapters[i].title && c.start === audioFiles[1].chapters[i].start))) {
        libraryScan.addLog(LogLevel.DEBUG, `setChapters: Using embedded chapters in first audio file ${audioFiles[0].metadata?.path}`)
        chapters = audioFiles[0].chapters.map((c) => ({ ...c }))
      } else {
        libraryScan.addLog(LogLevel.DEBUG, `setChapters: Using embedded chapters from all audio files ${audioFiles[0].metadata?.path}`)
        let currChapterId = 0
        let currStartTime = 0

        audioFiles.forEach((file) => {
          if (file.duration) {
            // Multi-file audiobook may include the previous and next chapters embedded with close to 0 duration
            // Filter these out and log a warning
            // See https://github.com/advplyr/audiobookshelf/issues/3361
            const afChaptersCleaned =
              file.chapters?.filter((c, i) => {
                if (c.end - c.start < 0.1) {
                  libraryScan.addLog(LogLevel.WARN, `Audio file "${file.metadata.filename}" Chapter "${c.title}" (index ${i}) has invalid duration of ${c.end - c.start} seconds. Skipping this chapter.`)
                  return false
                }
                return true
              }) || []

            const afChapters = afChaptersCleaned.map((c, i) => ({
              ...c,
              id: currChapterId + i,
              start: c.start + currStartTime,
              end: c.end + currStartTime
            }))
            chapters = chapters.concat(afChapters)

            currChapterId += afChaptersCleaned.length ?? 0
            currStartTime += file.duration
          }
        })
        return chapters
      }
    } else if (audioFiles.length > 1) {
      // In some cases the ID3 title tag for each file is the chapter title, the criteria to determine if this will be used
      // 1. Every audio file has an ID3 title tag set
      // 2. None of the title tags are the same as the book title
      // 3. Every ID3 title tag is unique
      const metaTagTitlesFound = [...new Set(audioFiles.map((af) => af.metaTags?.tagTitle).filter((tagTitle) => !!tagTitle && tagTitle !== bookTitle))]
      const useMetaTagAsTitle = metaTagTitlesFound.length === audioFiles.length

      // Build chapters from audio files
      let currChapterId = 0
      let currStartTime = 0
      audioFiles.forEach((file) => {
        if (file.duration) {
          let title = file.metadata.filename ? Path.basename(file.metadata.filename, Path.extname(file.metadata.filename)) : `Chapter ${currChapterId}`
          if (useMetaTagAsTitle) {
            // Every file has a title tag when useMetaTagAsTitle is true
            title = file.metaTags.tagTitle!
          }

          chapters.push({
            id: currChapterId++,
            start: currStartTime,
            end: currStartTime + file.duration,
            title
          })
          currStartTime += file.duration
        }
      })
    }
    return chapters
  }

  /**
   * Parse a genre string into multiple genres
   * @example "Fantasy;Sci-Fi;History" => ["Fantasy", "Sci-Fi", "History"]
   */
  parseGenresString(genreTag: string): string[] {
    if (!genreTag?.length) return []
    const separators = ['/', '//', ';']
    for (let i = 0; i < separators.length; i++) {
      if (genreTag.includes(separators[i])) {
        return genreTag
          .split(separators[i])
          .map((genre) => genre.trim())
          .filter((g) => !!g)
      }
    }
    return [genreTag]
  }
}
export = new AudioFileScanner()
