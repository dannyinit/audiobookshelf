import Path = require('path')
import fs = require('../libs/fsExtra')
import Logger = require('../Logger')
import TaskManager = require('./TaskManager')
import Task = require('../objects/Task')
import ffmpegHelpers = require('../utils/ffmpegHelpers')
import Ffmpeg = require('../libs/fluentFfmpeg')
import SocketAuthority = require('../SocketAuthority')
import fileUtils = require('../utils/fileUtils')
import TrackProgressMonitor = require('../objects/TrackProgressMonitor')
import type LibraryItem = require('../models/LibraryItem')
import type { ChapterObject } from '../models/types'
const { isWritable, copyToExisting } = fileUtils

/**
 * Encode options (codec, channels, bitrate) from the request
 */
type AbMergeEncodeOptions = Parameters<typeof ffmpegHelpers.mergeAudioFiles>[4]

/**
 * Data of an encode-m4b task (set in startAudiobookMerge)
 */
type MergeTaskData = {
  libraryItemId: string
  libraryItemDir: string
  userId: string
  originalTrackPaths: string[]
  inos: string[]
  tempFilepath: string
  targetFilename: string
  targetFilepath: string
  itemCachePath: string
  ffmetadataObject: ReturnType<typeof ffmpegHelpers.getFFMetadataObject>
  chapters: ChapterObject[]
  coverPath: string | null
  ffmetadataPath: string
  duration: number
  encodeOptions: AbMergeEncodeOptions
  /** Set while ffmpeg runs, so the task can be cancelled */
  ffmpeg?: CancellableFfmpegCommand
}

/**
 * fluent-ffmpeg command; kill defaults the signal to SIGKILL (the vendored typings require the signal)
 */
type CancellableFfmpegCommand = Omit<Ffmpeg.FfmpegCommand, 'kill'> & { kill(signal?: string): Ffmpeg.FfmpegCommand }

/**
 * Task with its encode-m4b data
 */
type MergeTask = Task & { data: MergeTaskData }

class AbMergeManager {
  declare itemsCacheDir: string
  declare pendingTasks: { id: string | null; task: MergeTask }[]

  constructor() {
    this.itemsCacheDir = Path.join(global.MetadataPath, 'cache/items')

    this.pendingTasks = []
  }

  getPendingTaskByLibraryItemId(libraryItemId: string) {
    return this.pendingTasks.find((t) => t.task.data.libraryItemId === libraryItemId)
  }

  /**
   * Cancel and fail running task
   */
  cancelEncode(task: MergeTask): Promise<void> {
    const taskFailedString = {
      text: 'Task canceled by user',
      key: 'MessageTaskCanceledByUser'
    }
    task.setFailed(taskFailedString)
    return this.removeTask(task, true)
  }

  async startAudiobookMerge(userId: string, libraryItem: LibraryItem.BookLibraryItem, options: AbMergeEncodeOptions = {}) {
    // cast(d): the data is set by setData below
    const task = new Task() as MergeTask

    const audiobookBaseName = libraryItem.isFile ? Path.basename(libraryItem.path, Path.extname(libraryItem.path)) : Path.basename(libraryItem.path)
    const targetFilename = audiobookBaseName + '.m4b'
    const itemCachePath = Path.join(this.itemsCacheDir, libraryItem.id)
    const tempFilepath = Path.join(itemCachePath, targetFilename)
    const ffmetadataPath = Path.join(itemCachePath, 'ffmetadata.txt')
    const libraryItemDir = libraryItem.isFile ? Path.dirname(libraryItem.path) : libraryItem.path
    const taskData: MergeTaskData = {
      libraryItemId: libraryItem.id,
      libraryItemDir,
      userId,
      originalTrackPaths: libraryItem.media.includedAudioFiles.map((t) => t.metadata.path),
      inos: libraryItem.media.includedAudioFiles.map((f) => f.ino),
      tempFilepath,
      targetFilename,
      targetFilepath: Path.join(libraryItemDir, targetFilename),
      itemCachePath,
      ffmetadataObject: ffmpegHelpers.getFFMetadataObject(libraryItem, 1),
      chapters: libraryItem.media.chapters?.map((c) => ({ ...c })),
      coverPath: libraryItem.media.coverPath,
      ffmetadataPath,
      duration: libraryItem.media.duration,
      encodeOptions: options
    }

    const taskTitleString = {
      text: 'Encoding M4b',
      key: 'MessageTaskEncodingM4b'
    }
    const taskDescriptionString = {
      text: `Encoding audiobook "${libraryItem.media.title}" into a single m4b file.`,
      key: 'MessageTaskEncodingM4bDescription',
      subs: [libraryItem.media.title]
    }
    task.setData('encode-m4b', taskTitleString, taskDescriptionString, false, taskData)
    TaskManager.addTask(task)
    Logger.info(`Start m4b encode for ${libraryItem.id} - TaskId: ${task.id}`)

    if (!(await fs.pathExists(taskData.itemCachePath))) {
      await fs.mkdir(taskData.itemCachePath)
    }

    this.runAudiobookMerge(libraryItem, task, options || {})
  }

  async runAudiobookMerge(libraryItem: LibraryItem.BookLibraryItem, task: MergeTask, encodingOptions: AbMergeEncodeOptions) {
    // Make sure the target directory is writable
    if (!(await isWritable(task.data.libraryItemDir))) {
      Logger.error(`[AbMergeManager] Target directory is not writable: ${task.data.libraryItemDir}`)
      const taskFailedString = {
        text: 'Target directory is not writable',
        key: 'MessageTaskTargetDirectoryNotWritable'
      }
      task.setFailed(taskFailedString)
      this.removeTask(task, true)
      return
    }

    // Create ffmetadata file
    if (!(await ffmpegHelpers.writeFFMetadataFile(task.data.ffmetadataObject, task.data.chapters, task.data.ffmetadataPath))) {
      Logger.error(`[AudioMetadataManager] Failed to write ffmetadata file for audiobook "${task.data.libraryItemId}"`)
      const taskFailedString = {
        text: 'Failed to write metadata file',
        key: 'MessageTaskFailedToWriteMetadataFile'
      }
      task.setFailed(taskFailedString)
      this.removeTask(task, true)
      return
    }

    this.pendingTasks.push({
      id: task.id,
      task
    })

    const encodeFraction = 0.95
    const embedFraction = 1 - encodeFraction
    try {
      const trackProgressMonitor = new TrackProgressMonitor(
        libraryItem.media.includedAudioFiles.map((t) => t.duration),
        (trackIndex) => SocketAuthority.adminEmitter('track_started', { libraryItemId: libraryItem.id, ino: task.data.inos[trackIndex] }),
        (trackIndex, progressInTrack, taskProgress) => {
          SocketAuthority.adminEmitter('track_progress', { libraryItemId: libraryItem.id, ino: task.data.inos[trackIndex], progress: progressInTrack })
          SocketAuthority.adminEmitter('task_progress', { libraryItemId: libraryItem.id, progress: taskProgress * encodeFraction })
        },
        (trackIndex) => SocketAuthority.adminEmitter('track_finished', { libraryItemId: libraryItem.id, ino: task.data.inos[trackIndex] })
      )
      // cast(a): the vendored fluent-ffmpeg is a function constructor, which TypeScript does not infer a construct signature for
      task.data.ffmpeg = new (Ffmpeg as unknown as new () => Ffmpeg.FfmpegCommand)()
      await ffmpegHelpers.mergeAudioFiles(libraryItem.media.includedAudioFiles, task.data.duration, task.data.itemCachePath, task.data.tempFilepath, encodingOptions, (progress) => trackProgressMonitor.update(progress), task.data.ffmpeg)
      delete task.data.ffmpeg
      trackProgressMonitor.finish()
    } catch (error) {
      // cast(d): catch variable is unknown
      if ((error as Error).message === 'FFMPEG_CANCELED') {
        Logger.info(`[AbMergeManager] Task cancelled ${task.id}`)
      } else {
        Logger.error(`[AbMergeManager] mergeAudioFiles failed`, error)
        const taskFailedString = {
          text: 'Failed to merge audio files',
          key: 'MessageTaskFailedToMergeAudioFiles'
        }
        task.setFailed(taskFailedString)
        this.removeTask(task, true)
      }
      return
    }

    // Write metadata to merged file
    try {
      // cast(a): the vendored fluent-ffmpeg is a function constructor, which TypeScript does not infer a construct signature for
      task.data.ffmpeg = new (Ffmpeg as unknown as new () => Ffmpeg.FfmpegCommand)()
      await ffmpegHelpers.addCoverAndMetadataToFile(
        task.data.tempFilepath,
        task.data.coverPath,
        task.data.ffmetadataPath,
        1,
        'audio/mp4',
        (progress) => {
          Logger.debug(`[AbMergeManager] Embedding metadata progress: ${100 * encodeFraction + progress * embedFraction}`)
          SocketAuthority.adminEmitter('task_progress', { libraryItemId: libraryItem.id, progress: 100 * encodeFraction + progress * embedFraction })
        },
        task.data.ffmpeg
      )
      delete task.data.ffmpeg
    } catch (error) {
      // cast(d): catch variable is unknown
      if ((error as Error).message === 'FFMPEG_CANCELED') {
        Logger.info(`[AbMergeManager] Task cancelled ${task.id}`)
      } else {
        Logger.error(`[AbMergeManager] Failed to embed metadata in file "${task.data.tempFilepath}"`)
        const taskFailedString = {
          text: `Failed to embed metadata in file ${Path.basename(task.data.tempFilepath)}`,
          key: 'MessageTaskFailedToEmbedMetadataInFile',
          subs: [Path.basename(task.data.tempFilepath)]
        }
        task.setFailed(taskFailedString)
        this.removeTask(task, true)
      }
      return
    }

    // Move library item tracks to cache
    for (const [index, trackPath] of task.data.originalTrackPaths.entries()) {
      const trackFilename = Path.basename(trackPath)
      let moveToPath = Path.join(task.data.itemCachePath, trackFilename)

      // If the track is the same as the temp file, we need to rename it to avoid overwriting it
      if (task.data.tempFilepath === moveToPath) {
        const trackExtname = Path.extname(task.data.tempFilepath)
        const newTrackFilename = Path.basename(task.data.tempFilepath, trackExtname) + '.backup' + trackExtname
        moveToPath = Path.join(task.data.itemCachePath, newTrackFilename)
      }

      Logger.debug(`[AbMergeManager] Backing up original track "${trackPath}" to ${moveToPath}`)
      if (index === 0) {
        // copy the first track to the cache directory
        await fs.copy(trackPath, moveToPath).catch((err: Error) => {
          Logger.error(`[AbMergeManager] Failed to copy track "${trackPath}" to "${moveToPath}"`, err)
        })
      } else {
        // move the rest of the tracks to the cache directory
        await fs.move(trackPath, moveToPath, { overwrite: true }).catch((err: Error) => {
          Logger.error(`[AbMergeManager] Failed to move track "${trackPath}" to "${moveToPath}"`, err)
        })
      }
    }

    // Move m4b to target, preserving the original track's permissions
    Logger.debug(`[AbMergeManager] Moving m4b from ${task.data.tempFilepath} to ${task.data.targetFilepath}`)
    try {
      await copyToExisting(task.data.tempFilepath, task.data.originalTrackPaths[0])
      await fs.rename(task.data.originalTrackPaths[0], task.data.targetFilepath)
      await fs.remove(task.data.tempFilepath)
    } catch (err) {
      Logger.error(`[AbMergeManager] Failed to move m4b from ${task.data.tempFilepath} to ${task.data.targetFilepath}`, err)
      const taskFailedString = {
        text: 'Failed to move m4b file',
        key: 'MessageTaskFailedToMoveM4bFile'
      }
      task.setFailed(taskFailedString)
      this.removeTask(task, true)
      return
    }

    // Remove ffmetadata file
    await fs.remove(task.data.ffmetadataPath)

    task.setFinished()
    await this.removeTask(task, false)
    Logger.info(`[AbMergeManager] Ab task finished ${task.id}`)
  }

  /**
   * Remove ab merge task
   *
   * @param [removeTempFilepath=false]
   */
  async removeTask(task: MergeTask, removeTempFilepath = false) {
    Logger.info('[AbMergeManager] Removing task ' + task.id)

    const pendingTask = this.pendingTasks.find((d) => d.id === task.id)
    if (pendingTask) {
      this.pendingTasks = this.pendingTasks.filter((d) => d.id !== task.id)
      if (task.data.ffmpeg) {
        Logger.warn(`[AbMergeManager] Killing ffmpeg process for task ${task.id}`)
        task.data.ffmpeg.kill()
        // wait for ffmpeg to exit, so that the output file is unlocked
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
      }
    }

    if (removeTempFilepath) {
      // On failed tasks remove the bad file if it exists
      if (await fs.pathExists(task.data.tempFilepath)) {
        await fs
          .remove(task.data.tempFilepath)
          .then(() => {
            Logger.info('[AbMergeManager] Deleted target file', task.data.tempFilepath)
          })
          .catch((err: Error) => {
            Logger.error('[AbMergeManager] Failed to delete target file', err)
          })
      }
      if (await fs.pathExists(task.data.ffmetadataPath)) {
        await fs
          .remove(task.data.ffmetadataPath)
          .then(() => {
            Logger.info('[AbMergeManager] Deleted ffmetadata file', task.data.ffmetadataPath)
          })
          .catch((err: Error) => {
            Logger.error('[AbMergeManager] Failed to delete ffmetadata file', err)
          })
      }
    }

    TaskManager.taskFinished(task)
  }
}
export = AbMergeManager
