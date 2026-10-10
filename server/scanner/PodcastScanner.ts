import uuid = require('uuid')
import Path = require('path')
import constants = require('../utils/constants')
import utils = require('../utils/index')
import AudioFileScanner = require('./AudioFileScanner')
import Database = require('../Database')
import fileUtils = require('../utils/fileUtils')
import AudioFile = require('../objects/files/AudioFile')
import CoverManager = require('../managers/CoverManager')
import LibraryFile = require('../objects/files/LibraryFile')
import fsExtra = require('../libs/fsExtra')
// Only used as a type; required for its side effects so the module load order stays as in the JS
import '../models/PodcastEpisode'
import type PodcastEpisode = require('../models/PodcastEpisode')
import AbsMetadataFileScanner = require('./AbsMetadataFileScanner')
import htmlSanitizer = require('../utils/htmlSanitizer')
import type LibraryItem = require('../models/LibraryItem')
import type { CreationAttributes, Includeable } from 'sequelize'
import type Podcast = require('../models/Podcast')
import type LibraryScan = require('./LibraryScan')
import type ScanLogger = require('./ScanLogger')
import type LibraryItemScanData = require('./LibraryItemScanData')
import type { AudioFileObject, LibraryFileObject, LibrarySettingsObject } from '../models/types'
import type { PodcastMetadataObject } from './types'
import dynamicKey = require('./dynamicKey')
const { getKey, setKey } = dynamicKey
const uuidv4 = uuid.v4
const { LogLevel } = constants
const { getTitleIgnorePrefix } = utils
const { filePathToPOSIX, getFileTimestampsWithIno } = fileUtils

/**
 * Plain podcast episode of a new podcast (created with the library item)
 */
type NewPodcastEpisode = Parameters<typeof AudioFileScanner.setPodcastEpisodeMetadataFromAudioMetaTags>[0] & {
  audioFile: ReturnType<AudioFile['toJSON']>
  chapters: AudioFile['chapters']
}

class PodcastScanner {
  constructor() {}

  async rescanExistingPodcastLibraryItem(existingLibraryItem: LibraryItem, libraryItemData: LibraryItemScanData, librarySettings: LibrarySettingsObject, libraryScan: LibraryScan | ScanLogger): Promise<{ libraryItem: LibraryItem; wasUpdated: boolean }> {
    // cast(d): the media of a podcast library item is a podcast (with its episodes included)
    const media = (await existingLibraryItem.getMedia({
      include: [
        {
          model: Database.podcastEpisodeModel
        }
      ]
    })) as Podcast

    let existingPodcastEpisodes: PodcastEpisode[] = media.podcastEpisodes

    let newAudioFiles: AudioFile[] = []

    // Track episode add/remove/update so item_updated includes the current episode list
    let hasEpisodeChanges = false

    if (libraryItemData.hasAudioFileChanges || libraryItemData.audioLibraryFiles.length !== existingPodcastEpisodes.length) {
      // Filter out and destroy episodes that were removed.
      // filter() returns a new array — reassign to media.podcastEpisodes before emit.
      const episodesToRemove: PodcastEpisode[] = []
      existingPodcastEpisodes = existingPodcastEpisodes.filter((ep) => {
        if (libraryItemData.checkAudioFileRemoved(ep.audioFile)) {
          episodesToRemove.push(ep)
          return false
        }
        return true
      })

      if (episodesToRemove.length) {
        hasEpisodeChanges = true
        // Remove episodes from playlists and media progress
        const episodeIds = episodesToRemove.map((ep) => ep.id)
        await Database.playlistModel.removeMediaItemsFromPlaylists(episodeIds)
        const mediaProgressRemoved = await Database.mediaProgressModel.destroy({
          where: {
            mediaItemId: episodeIds
          }
        })
        if (mediaProgressRemoved) {
          libraryScan.addLog(LogLevel.INFO, `Removed ${mediaProgressRemoved} media progress for episodes`)
        }

        // Remove episodes
        await Promise.all(
          episodesToRemove.map(async (ep) => {
            await ep.destroy()
            libraryScan.addLog(LogLevel.INFO, `Podcast episode "${ep.title}" audio file was removed`)
          })
        )
      }

      // Update audio files that were modified
      if (libraryItemData.audioLibraryFilesModified.length) {
        let scannedAudioFiles = await AudioFileScanner.executeMediaFileScans(
          existingLibraryItem.mediaType,
          libraryItemData,
          libraryItemData.audioLibraryFilesModified.map((lf) => lf.new)
        )

        for (const podcastEpisode of existingPodcastEpisodes) {
          let matchedScannedAudioFile = scannedAudioFiles.find((saf) => saf.metadata.path === podcastEpisode.audioFile.metadata.path)
          if (!matchedScannedAudioFile) {
            matchedScannedAudioFile = scannedAudioFiles.find((saf) => saf.ino === podcastEpisode.audioFile.ino)
          }

          if (matchedScannedAudioFile) {
            scannedAudioFiles = scannedAudioFiles.filter((saf) => saf !== matchedScannedAudioFile)
            const audioFile = new AudioFile(podcastEpisode.audioFile)
            audioFile.updateFromScan(matchedScannedAudioFile)
            // cast(d): the stored audio file JSON (AudioFile toJSON)
            podcastEpisode.audioFile = audioFile.toJSON() as AudioFileObject
            podcastEpisode.changed('audioFile', true)

            // Set metadata and save episode
            AudioFileScanner.setPodcastEpisodeMetadataFromAudioMetaTags(podcastEpisode, libraryScan)
            // cast(d): changed() returns false when nothing changed; false?.join is undefined, as in the JS
            libraryScan.addLog(LogLevel.INFO, `Podcast episode "${podcastEpisode.title}" keys changed [${(podcastEpisode.changed() as string[] | undefined)?.join(', ')}]`)
            await podcastEpisode.save()
            hasEpisodeChanges = true
          }
        }

        // Modified audio files that were not found as a podcast episode
        if (scannedAudioFiles.length) {
          newAudioFiles.push(...scannedAudioFiles)
        }
      }

      // Add new audio files scanned in
      if (libraryItemData.audioLibraryFilesAdded.length) {
        const scannedAudioFiles = await AudioFileScanner.executeMediaFileScans(existingLibraryItem.mediaType, libraryItemData, libraryItemData.audioLibraryFilesAdded)
        newAudioFiles.push(...scannedAudioFiles)
      }

      // Create new podcast episodes from new found audio files
      for (const newAudioFile of newAudioFiles) {
        // Podcast episode audio files always have index 1
        newAudioFile.index = 1

        const newEpisode = {
          // cast(d): a scanned audio file has meta tags (setDataFromProbe sets them)
          title: newAudioFile.metaTags!.tagTitle || newAudioFile.metadata.filenameNoExt,
          subtitle: null,
          season: null,
          episode: null,
          episodeType: null,
          pubDate: null,
          publishedAt: null,
          description: null,
          audioFile: newAudioFile.toJSON(),
          chapters: newAudioFile.chapters || [],
          podcastId: media.id
        }
        // cast(d): pubDate is null until the date tag sets it (the column allows null; the model types it as a string) and the audio file is the AudioFile JSON
        const newPodcastEpisode = Database.podcastEpisodeModel.build(newEpisode as unknown as CreationAttributes<PodcastEpisode>)
        // Set metadata and save new episode
        AudioFileScanner.setPodcastEpisodeMetadataFromAudioMetaTags(newPodcastEpisode, libraryScan)
        libraryScan.addLog(LogLevel.INFO, `New Podcast episode "${newPodcastEpisode.title}" added`)
        await newPodcastEpisode.save()
        existingPodcastEpisodes.push(newPodcastEpisode)
        hasEpisodeChanges = true
      }
    }

    // Keep association in sync for toOldJSONExpanded() / item_updated socket payload
    media.podcastEpisodes = existingPodcastEpisodes

    let hasMediaChanges = false
    if (existingPodcastEpisodes.length !== media.numEpisodes) {
      media.numEpisodes = existingPodcastEpisodes.length
      hasMediaChanges = true
    }

    // Check if cover was removed
    if (media.coverPath && libraryItemData.imageLibraryFilesRemoved.some((lf) => lf.metadata.path === media.coverPath)) {
      media.coverPath = null
      hasMediaChanges = true
    }

    // Update cover if it was modified
    if (media.coverPath && libraryItemData.imageLibraryFilesModified.length) {
      let coverMatch = libraryItemData.imageLibraryFilesModified.find((iFile) => iFile.old.metadata.path === media.coverPath)
      if (coverMatch) {
        const coverPath = coverMatch.new.metadata.path
        if (coverPath !== media.coverPath) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating podcast cover "${media.coverPath}" => "${coverPath}" for podcast "${media.title}"`)
          media.coverPath = coverPath
          media.changed('coverPath', true)
          hasMediaChanges = true
        }
      }
    }

    // Check if cover is not set and image files were found
    if (!media.coverPath && libraryItemData.imageLibraryFiles.length) {
      // Prefer using a cover image with the name "cover" otherwise use the first image
      // cast(d): scanned library files have a path (set by setDataFromPath)
      const coverMatch = libraryItemData.imageLibraryFiles.find((iFile) => /\/cover\.[^.\/]*$/.test(iFile.metadata.path!))
      media.coverPath = coverMatch?.metadata.path || libraryItemData.imageLibraryFiles[0].metadata.path
      hasMediaChanges = true
    }

    const podcastMetadata = await this.getPodcastMetadataFromScanData(existingPodcastEpisodes, libraryItemData, libraryScan, existingLibraryItem.id)

    for (const key in podcastMetadata) {
      // Ignore unset metadata and empty arrays
      // cast(d): dynamic metadata key (the length read: Array.isArray does not narrow the second getKey call)
      if (getKey(podcastMetadata, key) === undefined || (Array.isArray(getKey(podcastMetadata, key)) && !(getKey(podcastMetadata, key) as unknown[]).length)) continue

      if (key === 'genres') {
        const existingGenres = media.genres || []
        if (podcastMetadata.genres.some((g) => !existingGenres.includes(g)) || existingGenres.some((g) => !podcastMetadata.genres.includes(g))) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating podcast genres "${existingGenres.join(',')}" => "${podcastMetadata.genres.join(',')}" for podcast "${podcastMetadata.title}"`)
          media.genres = podcastMetadata.genres
          media.changed('genres', true)
          hasMediaChanges = true
        }
      } else if (key === 'tags') {
        const existingTags = media.tags || []
        if (podcastMetadata.tags.some((t) => !existingTags.includes(t)) || existingTags.some((t) => !podcastMetadata.tags.includes(t))) {
          libraryScan.addLog(LogLevel.DEBUG, `Updating podcast tags "${existingTags.join(',')}" => "${podcastMetadata.tags.join(',')}" for podcast "${podcastMetadata.title}"`)
          media.tags = podcastMetadata.tags
          media.changed('tags', true)
          hasMediaChanges = true
        }
      } else if (getKey(podcastMetadata, key) !== getKey(media, key)) {
        libraryScan.addLog(LogLevel.DEBUG, `Updating podcast ${key} "${getKey(media, key)}" => "${getKey(podcastMetadata, key)}" for podcast "${podcastMetadata.title}"`)
        // Dynamic metadata key: the podcast metadata keys are podcast fields of the same types: strings, explicit boolean
        setKey(media, key, getKey(podcastMetadata, key))
        hasMediaChanges = true
      }
    }

    // If no cover then extract cover from audio file if available
    if (!media.coverPath && existingPodcastEpisodes.length) {
      const audioFiles = existingPodcastEpisodes.map((ep) => ep.audioFile)
      const extractedCoverPath = await CoverManager.saveEmbeddedCoverArt(audioFiles, existingLibraryItem.id, existingLibraryItem.path)
      if (extractedCoverPath) {
        libraryScan.addLog(LogLevel.DEBUG, `Updating podcast "${podcastMetadata.title}" extracted embedded cover art from audio file to path "${extractedCoverPath}"`)
        media.coverPath = extractedCoverPath
        hasMediaChanges = true
      }
    }

    existingLibraryItem.media = media

    let libraryItemUpdated = false

    // Save Podcast changes to db
    if (hasMediaChanges) {
      await media.save()
      // cast(d): this scanner only rescans podcast library items (media is the podcast set above)
      await this.saveMetadataFile(existingLibraryItem as LibraryItem.PodcastLibraryItem, libraryScan)
      libraryItemUpdated = global.ServerSettings.storeMetadataWithItem
    }

    if (libraryItemUpdated) {
      existingLibraryItem.changed('libraryFiles', true)
      await existingLibraryItem.save()
    }

    return {
      libraryItem: existingLibraryItem,
      wasUpdated: hasMediaChanges || libraryItemUpdated || hasEpisodeChanges
    }
  }

  async scanNewPodcastLibraryItem(libraryItemData: LibraryItemScanData, librarySettings: LibrarySettingsObject, libraryScan: LibraryScan | ScanLogger): Promise<LibraryItem | null> {
    // Scan audio files found
    let scannedAudioFiles = await AudioFileScanner.executeMediaFileScans(libraryItemData.mediaType, libraryItemData, libraryItemData.audioLibraryFiles)

    // Do not add library items that have no valid audio files
    if (!scannedAudioFiles.length) {
      libraryScan.addLog(LogLevel.WARN, `Library item at path "${libraryItemData.relPath}" has no audio files - ignoring`)
      return null
    }

    const newPodcastEpisodes: NewPodcastEpisode[] = []

    // Create podcast episodes from audio files
    for (const audioFile of scannedAudioFiles) {
      // Podcast episode audio files always have index 1
      audioFile.index = 1

      const newEpisode: NewPodcastEpisode = {
        // cast(d): a scanned audio file has meta tags (setDataFromProbe sets them)
        title: audioFile.metaTags!.tagTitle || audioFile.metadata.filenameNoExt,
        subtitle: null,
        season: null,
        episode: null,
        episodeType: null,
        pubDate: null,
        publishedAt: null,
        description: null,
        audioFile: audioFile.toJSON(),
        chapters: audioFile.chapters || []
      }

      // Set metadata and save new episode
      AudioFileScanner.setPodcastEpisodeMetadataFromAudioMetaTags(newEpisode, libraryScan)
      libraryScan.addLog(LogLevel.INFO, `New Podcast episode "${newEpisode.title}" found`)
      newPodcastEpisodes.push(newEpisode)
    }

    const podcastMetadata = await this.getPodcastMetadataFromScanData(newPodcastEpisodes, libraryItemData, libraryScan)
    podcastMetadata.explicit = !!podcastMetadata.explicit // Ensure boolean

    // Set cover image from library file
    if (libraryItemData.imageLibraryFiles.length) {
      // Prefer using a cover image with the name "cover" otherwise use the first image
      // cast(d): scanned library files have a path (set by setDataFromPath)
      const coverMatch = libraryItemData.imageLibraryFiles.find((iFile) => /\/cover\.[^.\/]*$/.test(iFile.metadata.path!))
      podcastMetadata.coverPath = coverMatch?.metadata.path || libraryItemData.imageLibraryFiles[0].metadata.path
    }

    // Set default podcastType to episodic
    if (!podcastMetadata.podcastType) {
      podcastMetadata.podcastType = 'episodic'
    }

    const podcastObject = {
      ...podcastMetadata,
      autoDownloadEpisodes: false,
      autoDownloadSchedule: '0 * * * *',
      lastEpisodeCheck: 0,
      maxEpisodesToKeep: 0,
      maxNewEpisodesToDownload: 3,
      podcastEpisodes: newPodcastEpisodes,
      numEpisodes: newPodcastEpisodes.length
    }

    const libraryItemObj = libraryItemData.libraryItemObject
    libraryItemObj.id = uuidv4() // Generate library item id ahead of time to use for saving extracted cover image
    libraryItemObj.isMissing = false
    libraryItemObj.isInvalid = false
    libraryItemObj.extraData = {}
    libraryItemObj.title = podcastObject.title
    libraryItemObj.titleIgnorePrefix = getTitleIgnorePrefix(podcastObject.title)

    // If cover was not found in folder then check embedded covers in audio files
    if (!podcastObject.coverPath && scannedAudioFiles.length) {
      // Extract and save embedded cover art
      podcastObject.coverPath = await CoverManager.saveEmbeddedCoverArt(scannedAudioFiles, libraryItemObj.id, libraryItemObj.path)
    }

    libraryItemObj.podcast = podcastObject
    // cast(b): created with the nested podcast (the association sets mediaId) and the scanned LibraryFile objects (serialized with toJSON)
    const libraryItem = await Database.libraryItemModel.create(libraryItemObj as unknown as CreationAttributes<LibraryItem>, {
      // cast(b): sequelize accepts a single model or include object as a nested include, its types only allow an array
      include: {
        model: Database.podcastModel,
        include: Database.podcastEpisodeModel
      } as unknown as Includeable
    })

    // cast(b): the podcast is created with the library item (included above); the association is optional in the model
    Database.addGenresToFilterData(libraryItemData.libraryId, libraryItem.podcast!.genres)
    // cast(b): the podcast is created with the library item (included above); the association is optional in the model
    Database.addTagsToFilterData(libraryItemData.libraryId, libraryItem.podcast!.tags)

    // Load for emitting to client
    // cast(d): the media of the new podcast library item is the podcast created above
    libraryItem.media = (await libraryItem.getMedia({
      include: Database.podcastEpisodeModel
    })) as Podcast

    // cast(d): the library item was created as a podcast above
    await this.saveMetadataFile(libraryItem as LibraryItem.PodcastLibraryItem, libraryScan)
    if (global.ServerSettings.storeMetadataWithItem) {
      libraryItem.changed('libraryFiles', true)
      await libraryItem.save()
    }

    return libraryItem
  }

  /**
   *
   * @param podcastEpisodes Not the models for new podcasts
   * @param [existingLibraryItemId]
   */
  async getPodcastMetadataFromScanData(podcastEpisodes: (PodcastEpisode | NewPodcastEpisode)[], libraryItemData: LibraryItemScanData, libraryScan: LibraryScan | ScanLogger, existingLibraryItemId: string | null = null): Promise<PodcastMetadataObject> {
    const podcastMetadata: PodcastMetadataObject = {
      // cast(d): the folder or file name gives the title (LibraryItemScanData types it optional)
      title: libraryItemData.mediaMetadata.title!,
      titleIgnorePrefix: undefined,
      author: undefined,
      releaseDate: undefined,
      feedURL: undefined,
      imageURL: undefined,
      description: undefined,
      itunesPageURL: undefined,
      itunesId: undefined,
      itunesArtistId: undefined,
      language: undefined,
      podcastType: undefined,
      explicit: undefined,
      tags: [],
      genres: []
    }

    // Use audio meta tags
    if (podcastEpisodes.length) {
      AudioFileScanner.setPodcastMetadataFromAudioMetaTags(podcastEpisodes[0].audioFile, podcastMetadata, libraryScan)
    }

    // Use metadata.json file
    await AbsMetadataFileScanner.scanPodcastMetadataFile(libraryScan, libraryItemData, podcastMetadata, existingLibraryItemId)

    podcastMetadata.titleIgnorePrefix = getTitleIgnorePrefix(podcastMetadata.title)

    if (typeof podcastMetadata.description === 'string' && podcastMetadata.description) {
      podcastMetadata.description = htmlSanitizer.sanitize(podcastMetadata.description)
    }

    return podcastMetadata
  }

  /**
   */
  async saveMetadataFile(libraryItem: LibraryItem.PodcastLibraryItem, libraryScan: LibraryScan | ScanLogger) {
    let metadataPath = Path.join(global.MetadataPath, 'items', libraryItem.id)
    let storeMetadataWithItem = global.ServerSettings.storeMetadataWithItem
    if (storeMetadataWithItem) {
      metadataPath = libraryItem.path
    } else {
      // Make sure metadata book dir exists
      storeMetadataWithItem = false
      await fsExtra.ensureDir(metadataPath)
    }

    const metadataFilePath = Path.join(metadataPath, `metadata.${global.ServerSettings.metadataFileFormat}`)

    /**
     * Keys must match abmetadataGenerator.js
     */
    const jsonObject = {
      tags: libraryItem.media.tags || [],
      title: libraryItem.media.title,
      author: libraryItem.media.author,
      description: libraryItem.media.description,
      releaseDate: libraryItem.media.releaseDate,
      genres: libraryItem.media.genres || [],
      feedURL: libraryItem.media.feedURL,
      imageURL: libraryItem.media.imageURL,
      itunesPageURL: libraryItem.media.itunesPageURL,
      itunesId: libraryItem.media.itunesId,
      itunesArtistId: libraryItem.media.itunesArtistId,
      // NOTE: Podcast has no asin, so this is always undefined (and left out of metadata.json)
      // cast(c): read as in the JS (see NOTE above)
      asin: (libraryItem.media as Podcast & { asin?: string }).asin,
      language: libraryItem.media.language,
      explicit: !!libraryItem.media.explicit,
      podcastType: libraryItem.media.podcastType
    }
    return fsExtra
      .writeFile(metadataFilePath, JSON.stringify(jsonObject, null, 2))
      .then(async () => {
        // Add metadata.json to libraryFiles array if it is new
        let metadataLibraryFile = libraryItem.libraryFiles.find((lf) => lf.metadata.path === filePathToPOSIX(metadataFilePath))
        if (storeMetadataWithItem) {
          if (!metadataLibraryFile) {
            const newLibraryFile = new LibraryFile()
            await newLibraryFile.setDataFromPath(metadataFilePath, `metadata.json`)
            metadataLibraryFile = newLibraryFile.toJSON()
            libraryItem.libraryFiles.push(metadataLibraryFile)
          } else {
            const fileTimestamps = await getFileTimestampsWithIno(metadataFilePath)
            if (fileTimestamps) {
              metadataLibraryFile.metadata.mtimeMs = fileTimestamps.mtimeMs
              metadataLibraryFile.metadata.ctimeMs = fileTimestamps.ctimeMs
              metadataLibraryFile.metadata.size = fileTimestamps.size
              metadataLibraryFile.ino = fileTimestamps.ino
            }
          }
          const libraryItemDirTimestamps = await getFileTimestampsWithIno(libraryItem.path)
          if (libraryItemDirTimestamps) {
            libraryItem.mtime = libraryItemDirTimestamps.mtimeMs
            libraryItem.ctime = libraryItemDirTimestamps.ctimeMs
            let size = 0
            libraryItem.libraryFiles.forEach((lf) => (size += !isNaN(lf.metadata.size) ? Number(lf.metadata.size) : 0))
            libraryItem.size = size
          }
        }

        libraryScan.addLog(LogLevel.DEBUG, `Success saving abmetadata to "${metadataFilePath}"`)

        return metadataLibraryFile
      })
      .catch((error) => {
        libraryScan.addLog(LogLevel.ERROR, `Failed to save json file at "${metadataFilePath}"`, error)
        return null
      })
  }
}
export = new PodcastScanner()
