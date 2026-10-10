// Path is not used; the side-effect import keeps the require
import 'path'
import EventEmitter = require('events')
import Watcher = require('./libs/watcher/watcher')
import Logger = require('./Logger')
// Only used as a type here; the side-effect import keeps the require (and the load order)
import './objects/Task'
import TaskManager = require('./managers/TaskManager')

import fileUtils = require('./utils/fileUtils')
import type Task = require('./objects/Task')
import type Library = require('./models/Library')
import type LibraryFolder = require('./models/LibraryFolder')
const { filePathToPOSIX, isSameOrSubPath, getFileMTimeMs, shouldIgnoreFile } = fileUtils

interface PendingFileUpdate {
  path: string
  relPath: string
  folderId: string
  libraryId: string
  type: string
}

interface LibraryWatcher {
  id: string
  name: string
  libraryFolders: LibraryFolder[]
  paths: string[]
  /** One watcher for all folder paths of the library */
  watcher: Watcher
}

class FolderWatcher extends EventEmitter {
  declare libraryWatchers: LibraryWatcher[]
  declare pendingFileUpdates: PendingFileUpdate[]
  declare pendingDelay: number
  declare pendingTimeout: NodeJS.Timeout | null
  declare pendingTask: Task | null
  declare filesBeingAdded: Set<string>
  declare ignoreFilePathsDownloading: Set<string>
  declare ignoreDirs: string[]
  declare pendingDirsToRemoveFromIgnore: string[]
  declare removeFromIgnoreTimer: NodeJS.Timeout | null
  declare disabled: boolean

  constructor() {
    super()

    this.libraryWatchers = []
    this.pendingFileUpdates = []
    this.pendingDelay = 10000
    this.pendingTimeout = null
    this.pendingTask = null

    this.filesBeingAdded = new Set()

    this.ignoreFilePathsDownloading = new Set()
    this.ignoreDirs = []
    this.pendingDirsToRemoveFromIgnore = []
    this.removeFromIgnoreTimer = null

    this.disabled = false
  }

  get pendingFilePaths() {
    return this.pendingFileUpdates.map((f) => f.path)
  }

  /**
   *
   * @param library
   */
  buildLibraryWatcher(library: Library) {
    if (this.libraryWatchers.find((w) => w.id === library.id)) {
      Logger.warn('[Watcher] Already watching library', library.name)
      return
    }
    Logger.info(`[Watcher] Initializing watcher for "${library.name}".`)

    // cast(b): the callers pass libraries loaded with their folders (getAllWithFolders, the library controller); the association is optional in the model
    const folderPaths = library.libraryFolders!.map((f) => f.path)
    folderPaths.forEach((fp) => {
      Logger.debug(`[Watcher] Init watcher for library folder path "${fp}"`)
    })
    const watcher = new Watcher(folderPaths, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      renameDetection: true,
      renameTimeout: 2000,
      recursive: true,
      ignoreInitial: true,
      persistent: true
    })
    watcher
      .on('add', (path) => {
        this.onFileAdded(library.id, filePathToPOSIX(path))
      })
      .on('change', (path) => {
        // This is triggered from metadata changes, not what we want
      })
      .on('unlink', (path) => {
        this.onFileRemoved(library.id, filePathToPOSIX(path))
      })
      .on('rename', (path, pathNext) => {
        this.onFileRename(library.id, filePathToPOSIX(path), filePathToPOSIX(pathNext))
      })
      .on('error', (error) => {
        Logger.error(`[Watcher] ${error}`)
      })
      .on('ready', () => {
        Logger.info(`[Watcher] "${library.name}" Ready`)
      })
      .on('close', () => {
        Logger.debug(`[Watcher] "${library.name}" Closed`)
      })

    this.libraryWatchers.push({
      id: library.id,
      name: library.name,
      // cast(b): loaded with the library (see above); the association is optional in the model
      libraryFolders: library.libraryFolders!,
      paths: folderPaths,
      watcher
    })
  }

  /**
   *
   * @param libraries
   */
  initWatcher(libraries: Library[]) {
    libraries.forEach((lib) => {
      if (!lib.settings.disableWatcher) {
        this.buildLibraryWatcher(lib)
      }
    })
  }

  /**
   *
   * @param library
   */
  addLibrary(library: Library) {
    if (this.disabled || library.settings.disableWatcher) return
    this.buildLibraryWatcher(library)
  }

  /**
   *
   * @param library
   */
  updateLibrary(library: Library) {
    if (this.disabled) return

    const libwatcher = this.libraryWatchers.find((lib) => lib.id === library.id)
    if (libwatcher) {
      // Library watcher was disabled
      if (library.settings.disableWatcher) {
        Logger.info(`[Watcher] updateLibrary: Library "${library.name}" watcher disabled`)
        libwatcher.watcher.close()
        this.libraryWatchers = this.libraryWatchers.filter((lw) => lw.id !== libwatcher.id)
        return
      }

      libwatcher.name = library.name

      // If any folder paths were added or removed then re-init watcher
      // cast(b): the library controller passes the library loaded with its folders; the association is optional in the model
      const folderPaths = library.libraryFolders!.map((f) => f.path)
      const pathsToAdd = folderPaths.filter((path) => !libwatcher.paths.includes(path))
      const pathsRemoved = libwatcher.paths.filter((path) => !folderPaths.includes(path))
      if (pathsToAdd.length || pathsRemoved.length) {
        Logger.info(`[Watcher] Re-Initializing watcher for "${library.name}".`)

        libwatcher.watcher.close()
        this.libraryWatchers = this.libraryWatchers.filter((lw) => lw.id !== libwatcher.id)
        this.buildLibraryWatcher(library)
      }
    } else if (!library.settings.disableWatcher) {
      // Library watcher was enabled
      Logger.info(`[Watcher] updateLibrary: Library "${library.name}" watcher enabled - initializing`)
      this.buildLibraryWatcher(library)
    }
  }

  /**
   *
   * @param library
   */
  removeLibrary(library: Library) {
    if (this.disabled) return
    var libwatcher = this.libraryWatchers.find((lib) => lib.id === library.id)
    if (libwatcher) {
      Logger.info(`[Watcher] Removed watcher for "${library.name}"`)
      libwatcher.watcher.close()
      this.libraryWatchers = this.libraryWatchers.filter((lib) => lib.id !== library.id)
    } else {
      Logger.error(`[Watcher] Library watcher not found for "${library.name}"`)
    }
  }

  close() {
    return this.libraryWatchers.map((lib) => lib.watcher.close())
  }

  /**
   * Watcher detected file added
   *
   * @param libraryId
   * @param path
   */
  onFileAdded(libraryId: string, path: string) {
    if (this.checkShouldIgnorePath(path)) {
      return
    }
    Logger.debug('[Watcher] File Added', path)
    if (!this.addFileUpdate(libraryId, path, 'added')) {
      return
    }

    if (!this.filesBeingAdded.has(path)) {
      this.filesBeingAdded.add(path)
      this.waitForFileToAdd(path)
    }
  }

  /**
   * Watcher detected file removed
   *
   * @param libraryId
   * @param path
   */
  onFileRemoved(libraryId: string, path: string) {
    if (this.checkShouldIgnorePath(path)) {
      return
    }
    Logger.debug('[Watcher] File Removed', path)
    this.addFileUpdate(libraryId, path, 'deleted')
  }

  /**
   * Watcher detected file renamed
   *
   * @param libraryId
   * @param pathFrom
   * @param pathTo
   */
  onFileRename(libraryId: string, pathFrom: string, pathTo: string) {
    if (this.checkShouldIgnorePath(pathTo)) {
      return
    }
    Logger.debug(`[Watcher] Rename ${pathFrom} => ${pathTo}`)
    this.addFileUpdate(libraryId, pathTo, 'renamed')
  }

  /**
   * Get mtimeMs from an added file every 3 seconds until it is no longer changing
   * Times out after 600s
   *
   * @param path
   * @param [lastMTimeMs=0]
   * @param [loop=0]
   */
  async waitForFileToAdd(path: string, lastMTimeMs = 0, loop = 0): Promise<boolean | undefined> {
    // Safety to catch infinite loop (600s)
    if (loop >= 200) {
      Logger.warn(`[Watcher] Waiting to add file at "${path}" timeout (loop ${loop}) - bailing`)
      this.pendingFileUpdates = this.pendingFileUpdates.filter((pfu) => pfu.path !== path)
      return this.filesBeingAdded.delete(path)
    }

    const mtimeMs = await getFileMTimeMs(path)
    if (mtimeMs === lastMTimeMs) {
      if (lastMTimeMs) Logger.debug(`[Watcher] File finished adding at "${path}"`)
      return this.filesBeingAdded.delete(path)
    }
    if (loop % 5 === 0) {
      Logger.debug(`[Watcher] Waiting to add file at "${path}". mtimeMs=${mtimeMs} lastMTimeMs=${lastMTimeMs} (loop ${loop})`)
    }
    // Wait 3 seconds
    await new Promise((resolve) => setTimeout(resolve, 3000))
    this.waitForFileToAdd(path, mtimeMs, ++loop)
  }

  /**
   * Queue file update
   *
   * @param libraryId
   * @param path
   * @param type
   * @returns - If file was added to pending updates
   */
  addFileUpdate(libraryId: string, path: string, type: string): boolean {
    if (this.pendingFilePaths.includes(path)) return false

    // Get file library
    const libwatcher = this.libraryWatchers.find((lw) => lw.id === libraryId)
    if (!libwatcher) {
      Logger.error(`[Watcher] Invalid library id from watcher ${libraryId}`)
      return false
    }

    // Get file folder
    const folder = libwatcher.libraryFolders.find((fold) => isSameOrSubPath(fold.path, path))
    if (!folder) {
      Logger.error(`[Watcher] New file folder not found in library "${libwatcher.name}" with path "${path}"`)
      return false
    }

    const folderPath = filePathToPOSIX(folder.path)

    const relPath = path.replace(folderPath, '')

    // Check for ignored extensions or directories, such as dotfiles and hidden directories
    const shouldIgnore = shouldIgnoreFile(relPath)
    if (shouldIgnore) {
      Logger.debug(`[Watcher] Ignoring ${shouldIgnore} - "${relPath}"`)
      return false
    }

    Logger.debug(`[Watcher] Modified file in library "${libwatcher.name}" and folder "${folder.id}" with relPath "${relPath}"`)

    if (!this.pendingTask) {
      const taskData = {
        libraryId,
        libraryName: libwatcher.name
      }
      const taskTitleString = {
        text: `Scanning file changes in "${libwatcher.name}"`,
        key: 'MessageTaskScanningFileChanges',
        subs: [libwatcher.name]
      }
      this.pendingTask = TaskManager.createAndAddTask('watcher-scan', taskTitleString, null, true, taskData)
    }
    this.pendingFileUpdates.push({
      path,
      relPath,
      folderId: folder.id,
      libraryId,
      type
    })

    this.handlePendingFileUpdatesTimeout()
    return true
  }

  /**
   * Wait X seconds before notifying scanner that files changed
   * reset timer if files are still copying
   */
  handlePendingFileUpdatesTimeout() {
    // cast(d): clearTimeout(null) does nothing, but @types/node does not accept null
    clearTimeout(this.pendingTimeout as NodeJS.Timeout)
    this.pendingTimeout = setTimeout(() => {
      // Check that files are not still being added
      if (this.pendingFileUpdates.some((pfu) => this.filesBeingAdded.has(pfu.path))) {
        Logger.debug(`[Watcher] Still waiting for pending files "${[...this.filesBeingAdded].join(', ')}"`)
        return this.handlePendingFileUpdatesTimeout()
      }

      if (this.pendingFileUpdates.length) {
        this.emit('scanFilesChanged', this.pendingFileUpdates, this.pendingTask)
      } else {
        const taskFinishedString = {
          text: 'No files to scan',
          key: 'MessageTaskNoFilesToScan'
        }
        // cast(d): pendingTask is set by addFileUpdate before it starts this timeout
        this.pendingTask!.setFinished(taskFinishedString)
        // cast(d): pendingTask is set by addFileUpdate (as above)
        TaskManager.taskFinished(this.pendingTask!)
      }
      this.pendingTask = null
      this.pendingFileUpdates = []
      this.filesBeingAdded.clear()
    }, this.pendingDelay)
  }

  /**
   *
   * @param path
   */
  checkShouldIgnorePath(path: string): boolean {
    return !!this.ignoreDirs.find((dirpath) => {
      return isSameOrSubPath(dirpath, path)
    })
  }

  /**
   * When scanning a library item folder these files should be ignored
   * Either a podcast episode downloading or a file that is pending by the watcher
   *
   * @param path
   */
  checkShouldIgnoreFilePath(path: string): boolean {
    if (this.pendingFilePaths.includes(path)) return true
    return this.ignoreFilePathsDownloading.has(path)
  }

  /**
   * Convert to POSIX and remove trailing slash
   * @param path
   */
  cleanDirPath(path: string): string {
    path = filePathToPOSIX(path)
    if (path.endsWith('/')) path = path.slice(0, -1)
    return path
  }

  /**
   * Ignore this directory if files are picked up by watcher
   * @param path
   */
  addIgnoreDir(path: string) {
    path = this.cleanDirPath(path)
    this.pendingDirsToRemoveFromIgnore = this.pendingDirsToRemoveFromIgnore.filter((p) => p !== path)
    if (this.ignoreDirs.includes(path)) {
      // Already ignoring dir
      return
    }
    Logger.debug(`[Watcher] addIgnoreDir: Ignoring directory "${path}"`)
    this.ignoreDirs.push(path)
  }

  /**
   * When downloading a podcast episode we dont want the scanner triggering for that podcast
   * when the episode finishes the watcher may have a delayed response so a timeout is added
   * to prevent the watcher from picking up the episode
   *
   * @param path
   */
  removeIgnoreDir(path: string) {
    path = this.cleanDirPath(path)
    if (!this.ignoreDirs.includes(path)) {
      Logger.debug(`[Watcher] removeIgnoreDir: Path is not being ignored "${path}"`)
      return
    }

    // Add a 5 second delay before removing the ignore from this dir
    if (!this.pendingDirsToRemoveFromIgnore.includes(path)) {
      this.pendingDirsToRemoveFromIgnore.push(path)
    }

    // cast(d): clearTimeout(null) does nothing, but @types/node does not accept null
    clearTimeout(this.removeFromIgnoreTimer as NodeJS.Timeout)
    this.removeFromIgnoreTimer = setTimeout(() => {
      if (this.pendingDirsToRemoveFromIgnore.includes(path)) {
        this.pendingDirsToRemoveFromIgnore = this.pendingDirsToRemoveFromIgnore.filter((p) => p !== path)
        Logger.debug(`[Watcher] removeIgnoreDir: No longer ignoring directory "${path}"`)
        this.ignoreDirs = this.ignoreDirs.filter((p) => p !== path)
      }
    }, 5000)
  }
}
const folderWatcher = new FolderWatcher()
// Types of this module (other files use import('../Watcher').PendingFileUpdate); a type-only namespace emits nothing
declare namespace folderWatcher {
  export { PendingFileUpdate }
}
export = folderWatcher
